import { BrowserCodeReader, BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import * as React from 'react';

export type CameraStatus =
  | 'idle' // camera not requested yet
  | 'starting'
  | 'scanning'
  | 'denied' // the user (or a policy) refused camera access
  | 'no-camera'
  | 'insecure' // not HTTPS → browsers refuse camera access entirely
  | 'error';

export interface QrScanner {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  torchSupported: boolean;
  torchOn: boolean;
  /** Asks for the camera. Call from a user gesture the first time. */
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
  switchCamera: () => void;
  toggleTorch: () => void;
}

const DEVICE_KEY = 'scanner.cameraId';
/** The same code must leave the frame (or this long must pass) before it is reported again. */
const REPEAT_GUARD_MS = 4000;

function readPreferredDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

/**
 * Camera + QR decoding (ZXing).
 *
 * `paused` keeps the camera running but drops every decoded frame, so the
 * scanner resumes instantly after a result is dismissed. Together with the
 * repeat guard this guarantees ONE callback per presented ticket, no matter
 * how many consecutive frames contain the same code.
 */
export function useQrScanner(onDetect: (text: string) => void, paused: boolean): QrScanner {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const onDetectRef = React.useRef(onDetect);
  const pausedRef = React.useRef(paused);
  const lastRef = React.useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const [status, setStatus] = React.useState<CameraStatus>('idle');
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = React.useState<string | null>(readPreferredDevice);
  const [torchSupported, setTorchSupported] = React.useState(false);
  const [torchOn, setTorchOn] = React.useState(false);

  onDetectRef.current = onDetect;
  React.useEffect(() => {
    // Resuming: allow the previous code again only after the guard interval.
    if (pausedRef.current && !paused) lastRef.current.at = Date.now();
    pausedRef.current = paused;
  }, [paused]);

  const stop = React.useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const start = React.useCallback(
    async (requestedId?: string) => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('insecure');
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      stop();
      setStatus('starting');

      const wanted = requestedId ?? deviceId ?? undefined;
      const constraints = (id?: string): MediaStreamConstraints => ({
        audio: false,
        video: id
          ? { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 300 });
      const handle = (result: { getText(): string } | undefined) => {
        if (!result || pausedRef.current) return;
        const text = result.getText();
        const now = Date.now();
        if (text === lastRef.current.text && now - lastRef.current.at < REPEAT_GUARD_MS) {
          lastRef.current.at = now; // still in frame – keep extending the guard
          return;
        }
        lastRef.current = { text, at: now };
        onDetectRef.current(text);
      };

      try {
        let controls: IScannerControls;
        try {
          controls = await reader.decodeFromConstraints(constraints(wanted), video, handle);
        } catch (err) {
          // A remembered camera that no longer exists → fall back to the default one.
          if (wanted && (err as DOMException).name === 'OverconstrainedError') {
            controls = await reader.decodeFromConstraints(constraints(), video, handle);
          } else {
            throw err;
          }
        }
        controlsRef.current = controls;
        setTorchSupported(typeof controls.switchTorch === 'function');
        setStatus('scanning');

        const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
        const activeId = track?.getSettings().deviceId ?? null;
        setDeviceId(activeId);
        // Labels are only available after permission was granted.
        setDevices(await BrowserCodeReader.listVideoInputDevices().catch(() => []));
      } catch (err) {
        const name = (err as DOMException).name;
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setStatus('no-camera');
        else setStatus('error');
      }
    },
    [deviceId, stop],
  );

  const switchCamera = React.useCallback(() => {
    if (devices.length < 2) return;
    const index = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(index + 1) % devices.length];
    try {
      localStorage.setItem(DEVICE_KEY, next.deviceId);
    } catch {
      /* preference only */
    }
    void start(next.deviceId);
  }, [devices, deviceId, start]);

  const toggleTorch = React.useCallback(() => {
    const controls = controlsRef.current;
    if (!controls?.switchTorch) return;
    const next = !torchOn;
    controls
      .switchTorch(next)
      .then(() => setTorchOn(next))
      .catch(() => setTorchSupported(false));
  }, [torchOn]);

  // Release the camera when leaving the page or when the tab is hidden.
  React.useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (controlsRef.current) {
          stop();
          setStatus('idle');
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [stop]);

  return { videoRef, status, devices, deviceId, torchSupported, torchOn, start, stop, switchCamera, toggleTorch };
}

/** True when the browser already holds camera permission (so we may start without a tap). */
export async function cameraAlreadyGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}
