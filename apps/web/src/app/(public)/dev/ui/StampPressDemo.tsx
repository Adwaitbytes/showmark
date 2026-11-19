"use client";

import { useState } from "react";
import { Button } from "@/ui/Button";
import { Stamp } from "@/ui/stamp/Stamp";
import { pressHaptic, StampPress } from "@/ui/stamp/StampPress";

export function StampPressDemo() {
  const [presses, setPresses] = useState(0);
  return (
    <div className="flex flex-col items-start gap-6">
      <div className="grid size-56 place-items-center rounded-doc bg-sheet shadow-sheet">
        {presses > 0 ? (
          <StampPress pressKey={presses} haptic={false}>
            <Stamp
              eventId="12"
              eventName="Sample builders meetup"
              city="Bengaluru"
              at="2026-11-27T12:41:00.000Z"
              mode={1}
              ink="vermilion"
              shape="round"
              holder={String(presses)}
              className="w-44"
            />
          </StampPress>
        ) : (
          <p className="px-6 text-center text-sm text-ink-soft">The stamp lands here.</p>
        )}
      </div>
      <Button
        variant="primary"
        onClick={() => {
          pressHaptic();
          setPresses((n) => n + 1);
        }}
      >
        Press the stamp
      </Button>
    </div>
  );
}
