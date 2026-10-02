"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Spinner } from "@/components/ui";

interface QrScannerProps {
  /** When true, requests camera access and starts decoding. */
  active: boolean;
  /** Decoded QR payload (the ticket's qr_code_hash). */
  onScan: (value: string) => void;
  /** Fatal camera error (permission denied, no camera, etc.). */
  onCameraError: () => void;
}

const REGION_ID = "qr-reader-region";

/**
 * Thin wrapper around html5-qrcode. The library is imported dynamically so it
 * never runs during SSR, and callbacks are kept in refs so changing handlers
 * does not restart the camera stream.
 */
export function QrScanner({ active, onScan, onCameraError }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const onCameraErrorRef = useRef(onCameraError);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
    onCameraErrorRef.current = onCameraError;
  }, [onScan, onCameraError]);

  useEffect(() => {
    let cancelled = false;

    const stopExisting = async () => {
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        try {
          await scanner.stop();
          scanner.clear();
        } catch {
          // Already stopped — nothing to do.
        }
      }
    };

    if (!active) {
      void stopExisting();
      return;
    }

    const start = async () => {
      setStarting(true);
      try {
        const { Html5Qrcode: ScannerCtor } = await import("html5-qrcode");
        if (cancelled) return;

        const scanner = new ScannerCtor(REGION_ID, { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => onScanRef.current(decodedText),
          // Per-frame decode misses are normal camera noise — ignore them.
          () => {},
        );
      } catch {
        if (!cancelled) {
          await stopExisting();
          onCameraErrorRef.current();
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      void stopExisting();
    };
  }, [active]);

  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-700">
      <div id={REGION_ID} className="mx-auto w-full [&_video]:rounded-2xl [&_video]:w-full" />
      {!active && (
        <div className="grid aspect-video w-full place-items-center text-sm text-slate-400">
          {starting ? <Spinner className="size-8" /> : <span aria-hidden>📷</span>}
        </div>
      )}
    </div>
  );
}
