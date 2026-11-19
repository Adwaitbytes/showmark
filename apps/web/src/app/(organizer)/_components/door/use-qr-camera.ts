"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Reads QR codes from the back camera. Uses the browser's own BarcodeDetector where it exists (Chrome on Android,
// recent Safari) and loads jsQR only when it does not, so most door phones never download the fallback.

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

const SCAN_INTERVAL_MS = 180;
const MAX_FALLBACK_WIDTH = 640;

async function nativeDecoder(): Promise<Decoder | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    const detector = new Ctor({ formats: ["qr_code"] });
    return async (video) => {
      const codes = await detector.detect(video);
      return codes[0]?.rawValue ?? null;
    };
  } catch {
    return null;
  }
}

async function jsqrDecoder(): Promise<Decoder> {
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!context || video.videoWidth === 0) return null;
    const scale = Math.min(1, MAX_FALLBACK_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

export type CameraState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "denied" }
  | { kind: "unavailable"; reason: string };

export function useQrCamera(onCode: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>({ kind: "idle" });
  const streamRef = useRef<MediaStream | null>(null);
  const onCodeRef = useRef(onCode);

  useEffect(() => {
    onCodeRef.current = onCode;
  });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ kind: "unavailable", reason: "This browser cannot use the camera. Open the scanner in Chrome or Safari, or type codes by hand below." });
      return;
    }
    setState({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      setState({ kind: "running" });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setState({ kind: "denied" });
      else setState({ kind: "unavailable", reason: "No camera could be started on this device. Close other apps that use the camera and try again, or type codes by hand below." });
    }
  }, []);

  useEffect(() => {
    if (state.kind !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let decode: Decoder | null = null;
    const loop = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      try {
        decode ??= (await nativeDecoder()) ?? (await jsqrDecoder());
        if (video && video.readyState >= 2) {
          const text = await decode(video);
          if (text && !cancelled) onCodeRef.current(text);
        }
      } catch {
        // A single bad frame is normal; keep scanning.
      }
      if (!cancelled) timer = setTimeout(() => void loop(), SCAN_INTERVAL_MS);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [state.kind]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return { videoRef, state, start, stop };
}
