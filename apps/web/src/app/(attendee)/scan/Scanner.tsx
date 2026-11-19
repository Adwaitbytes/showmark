"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/checkin/locale";
import { decodeAttendeeCode, decodeDoorPass, encodeDoorPass } from "@/lib/qr/payload";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { RetryIcon } from "@/ui/icons";
import { TorchIcon } from "../_components/icons";

// Native BarcodeDetector (Chrome on Android, Safari 17+) when it reads QR codes; otherwise jsQR on a
// canvas, loaded only here and only when needed, so it never weighs on the check-in route.

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean };

type Reader = (video: HTMLVideoElement) => Promise<string[]>;

type CameraState = "starting" | "live" | "denied" | "no-camera" | "busy" | "failed";
type Notice = "not-showmark" | "attendee-code" | null;

const SCAN_INTERVAL_MS = 120;
/** jsQR is slow on big frames; a 640 px frame reads a door code from arm's length. */
const FALLBACK_FRAME = 640;

async function nativeReader(): Promise<Reader | null> {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = (await Detector.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    const detector = new Detector({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video)).map((code) => code.rawValue);
  } catch {
    return null;
  }
}

async function canvasReader(): Promise<Reader> {
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!context || video.videoWidth === 0) return [];
    const scale = Math.min(1, FALLBACK_FRAME / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
    return code ? [code.data] : [];
  };
}

function cameraState(error: unknown): CameraState {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotSupportedError" || name === "TypeError") return "no-camera";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}

export function Scanner() {
  const { t } = useLocale();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [notice, setNotice] = useState<Notice>(null);
  const [found, setFound] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let noticeTimer: number | undefined;

    function handle(values: string[]): boolean {
      for (const value of values) {
        const door = decodeDoorPass(value);
        if (door) {
          // Navigate to our own route rebuilt from the decoded code, never to whatever URL was in the QR.
          setFound(true);
          stop();
          router.push(`/c/${encodeDoorPass(door)}`);
          return true;
        }
        const next: Notice = decodeAttendeeCode(value) ? "attendee-code" : "not-showmark";
        setNotice(next);
        window.clearTimeout(noticeTimer);
        noticeTimer = window.setTimeout(() => setNotice(null), 4000);
      }
      return false;
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("no-camera");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (error) {
        if (!cancelled) setCamera(cameraState(error));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (error) {
        if (!cancelled) setCamera(cameraState(error));
        return;
      }
      const [track] = stream.getVideoTracks();
      const capabilities: TorchCapabilities = typeof track?.getCapabilities === "function" ? track.getCapabilities() : {};
      setTorch({ supported: capabilities.torch === true, on: false });
      setCamera("live");

      const read = (await nativeReader()) ?? (await canvasReader());
      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            if (handle(await read(video))) return;
          } catch {
            // A single unreadable frame is normal; keep scanning.
          }
        }
        timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
      };
      void tick();
    }

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(noticeTimer);
      stop();
    };
  }, [attempt, router, stop]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as TorchConstraintSet] });
      setTorch({ supported: true, on });
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  const failure =
    camera === "denied" ? t.scan.cameraDenied : camera === "no-camera" ? t.scan.noCamera : camera === "busy" ? t.scan.cameraBusy : camera === "failed" ? t.scan.cameraFailed : null;

  if (failure) {
    return (
      <ErrorState
        title={failure.message}
        action={
          <Button
            variant="primary"
            onClick={() => {
              setCamera("starting");
              setAttempt((n) => n + 1);
            }}
            leading={<RetryIcon className="size-4" />}
          >
            {t.scan.startCamera}
          </Button>
        }
      >
        {failure.action}
      </ErrorState>
    );
  }

  const noticeCopy = notice === "attendee-code" ? t.scan.attendeeCode : notice === "not-showmark" ? t.scan.notShowmark : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="relative mx-auto aspect-square w-full max-w-[26rem] overflow-hidden rounded-doc bg-night shadow-lift">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={t.scan.viewfinderLabel}
          className={cn("size-full object-cover transition-opacity duration-300", camera === "live" ? "opacity-100" : "opacity-0")}
        />
        <Viewfinder found={found} />
        {camera === "starting" ? (
          <p className="absolute inset-x-0 bottom-6 text-center text-base text-[#ede7db]" role="status">
            {t.scan.starting}
          </p>
        ) : null}
      </div>

      <div role="status" aria-live="polite" className="min-h-6 text-center">
        {found ? (
          <p className="text-base font-medium text-ink">{t.scan.found}</p>
        ) : noticeCopy ? (
          <p className="text-base text-ink">
            <span className="font-medium">{noticeCopy.message}</span> <span className="text-ink-soft">{noticeCopy.action}</span>
          </p>
        ) : null}
      </div>

      {torch.supported ? (
        <Button variant="quiet" size="lg" block onClick={toggleTorch} aria-pressed={torch.on} leading={<TorchIcon className="size-5" />} className="mx-auto max-w-[26rem]">
          {torch.on ? t.scan.torchOff : t.scan.torchOn}
        </Button>
      ) : null}
    </div>
  );
}

/** Registration corners over the camera, the same marks the door code is printed inside. */
function Viewfinder({ found }: { found: boolean }) {
  const corner = cn("absolute size-12 transition-colors duration-200", found ? "border-ledger-green" : "border-[#faf7f0]");
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-[12%]">
      <span className={cn(corner, "top-0 left-0 border-t-4 border-l-4")} />
      <span className={cn(corner, "top-0 right-0 border-t-4 border-r-4")} />
      <span className={cn(corner, "bottom-0 left-0 border-b-4 border-l-4")} />
      <span className={cn(corner, "right-0 bottom-0 border-r-4 border-b-4")} />
    </span>
  );
}
