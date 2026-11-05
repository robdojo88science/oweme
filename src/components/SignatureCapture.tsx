import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Camera,
  Check,
  PenLine,
  RotateCw,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type { SignatureRef } from "../core/model";
import {
  canvasBlob,
  cleanSignature,
  compressImage,
  loadImage,
  rotateCanvas,
} from "../media/images";
import type { Point, Quadrilateral } from "../media/images";

interface Props {
  value?: SignatureRef;
  onChange: (value?: SignatureRef) => void;
  signerName: string;
  label?: string;
}
const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 44,
  padding: "8px 12px",
  border: "1px solid #e7e8ee",
  borderRadius: 10,
  background: "#fff",
  color: "#33374c",
  cursor: "pointer",
  fontSize: 13,
} as const;
const cropCorners = (
  width: number,
  height: number,
  inset = 0.08,
): Quadrilateral => [
  { x: width * inset, y: height * inset },
  { x: width * (1 - inset), y: height * inset },
  { x: width * (1 - inset), y: height * (1 - inset) },
  { x: width * inset, y: height * (1 - inset) },
];
function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function SignatureCapture({
  value,
  onChange,
  signerName,
  label = "Signature",
}: Props) {
  const [mode, setMode] = useState<"closed" | "photo" | "draw">("closed");
  const [original, setOriginal] = useState<Blob>();
  const [corners, setCorners] = useState<Quadrilateral>(cropCorners(600, 300));
  const [perspective, setPerspective] = useState(false);
  const [sourceVersion, setSourceVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraStream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const photoCanvas = useRef<HTMLCanvasElement | null>(null);
  const drawCanvas = useRef<HTMLCanvasElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{ handle: number; start: Point } | null>(null);
  const drawing = useRef(false);
  const last = useRef<Point | null>(null);
  const lastMidpoint = useRef<Point | null>(null);
  const history = useRef<ImageData[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const processedUrl = useBlobUrl(value?.processed);
  const originalUrl = useBlobUrl(mode === "photo" ? original : value?.original);

  useEffect(
    () => () => {
      cameraStream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  useEffect(() => {
    if (cameraOpen && video.current && cameraStream.current)
      video.current.srcObject = cameraStream.current;
  }, [cameraOpen]);
  function stopCamera() {
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    setCameraOpen(false);
  }
  async function openCamera() {
    setError("");
    try {
      cameraStream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 } },
        audio: false,
      });
      setCameraOpen(true);
    } catch {
      setError(
        "Live camera is unavailable. Use Scan paper or Upload to choose a photo.",
      );
    }
  }
  async function captureCamera() {
    if (!video.current?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    canvas.getContext("2d")!.drawImage(video.current, 0, 0);
    const blob = await canvasBlob(canvas, "image/jpeg", 0.8);
    stopCamera();
    await choosePhoto(
      new File([blob], "signature-photo.jpg", { type: "image/jpeg" }),
    );
  }

  useEffect(() => {
    const canvas = photoCanvas.current;
    const image = source.current;
    if (!canvas || !image || mode !== "photo") return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    ctx.fillStyle = "#14182a66";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    corners.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, 0, 0);
    ctx.restore();
    ctx.beginPath();
    corners.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.closePath();
    ctx.strokeStyle = "#5b5cff";
    ctx.lineWidth = Math.max(3, canvas.width / 220);
    ctx.stroke();
    corners.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(8, canvas.width / 70), 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.stroke();
    });
  }, [corners, sourceVersion, mode]);

  useEffect(() => {
    if (mode !== "draw") return;
    const canvas = drawCanvas.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    history.current = [];
    setStrokeCount(0);
  }, [mode]);

  async function choosePhoto(file?: File) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const image = await loadImage(compressed);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      source.current = canvas;
      setOriginal(compressed);
      setCorners(cropCorners(canvas.width, canvas.height));
      setSourceVersion((v) => v + 1);
      setMode("photo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this photo.");
    } finally {
      setBusy(false);
      if (cameraInput.current) cameraInput.current.value = "";
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }
  function eventPoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          event.currentTarget.width - 1,
          ((event.clientX - rect.left) * event.currentTarget.width) /
            rect.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          event.currentTarget.height - 1,
          ((event.clientY - rect.top) * event.currentTarget.height) /
            rect.height,
        ),
      ),
    };
  }
  function cropStart(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = eventPoint(event);
    const nearest = corners.reduce(
      (best, p, i) =>
        Math.hypot(p.x - point.x, p.y - point.y) <
        Math.hypot(corners[best].x - point.x, corners[best].y - point.y)
          ? i
          : best,
      0,
    );
    drag.current = { handle: perspective ? nearest : -1, start: point };
  }
  function cropMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    const point = eventPoint(event);
    const { handle, start } = drag.current;
    if (handle >= 0)
      setCorners(
        (previous) =>
          previous.map((p, i) => (i === handle ? point : p)) as Quadrilateral,
      );
    else {
      const left = Math.min(start.x, point.x);
      const right = Math.max(start.x + 1, point.x);
      const top = Math.min(start.y, point.y);
      const bottom = Math.max(start.y + 1, point.y);
      setCorners([
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ]);
    }
  }
  function drawStart(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = event.currentTarget.getContext("2d")!;
    history.current.push(
      ctx.getImageData(
        0,
        0,
        event.currentTarget.width,
        event.currentTarget.height,
      ),
    );
    drawing.current = true;
    last.current = eventPoint(event);
    lastMidpoint.current = last.current;
    setStrokeCount(history.current.length);
    ctx.fillStyle = "#131a2e";
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const point = eventPoint(event);
    const ctx = event.currentTarget.getContext("2d")!;
    ctx.strokeStyle = "#131a2e";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2 + (event.pressure || 0.5) * 3;
    const midpoint = {
      x: (point.x + last.current.x) / 2,
      y: (point.y + last.current.y) / 2,
    };
    ctx.beginPath();
    ctx.moveTo(
      lastMidpoint.current?.x ?? last.current.x,
      lastMidpoint.current?.y ?? last.current.y,
    );
    ctx.quadraticCurveTo(
      last.current.x,
      last.current.y,
      midpoint.x,
      midpoint.y,
    );
    ctx.stroke();
    last.current = point;
    lastMidpoint.current = midpoint;
  }
  function drawEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawing.current && last.current && lastMidpoint.current) {
      const ctx = event.currentTarget.getContext("2d")!;
      ctx.beginPath();
      ctx.moveTo(lastMidpoint.current.x, lastMidpoint.current.y);
      ctx.lineTo(last.current.x, last.current.y);
      ctx.stroke();
    }
    drawing.current = false;
    last.current = null;
    lastMidpoint.current = null;
  }
  function clearDraw() {
    const canvas = drawCanvas.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    history.current = [];
    setStrokeCount(0);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      let evidence: Blob;
      let processed: Blob;
      if (mode === "photo" && source.current && original) {
        evidence = original;
        processed = await cleanSignature(source.current, corners);
      } else if (mode === "draw" && drawCanvas.current) {
        evidence = await canvasBlob(drawCanvas.current);
        processed = await cleanSignature(drawCanvas.current);
      } else return;
      onChange({
        original: evidence,
        processed,
        signerName,
        capturedAt: new Date().toISOString(),
      });
      setMode("closed");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save the signature.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      style={{
        border: "1px solid #e7e8ee",
        borderRadius: 14,
        padding: 14,
        background: "#fafafb",
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>{label}</strong>
        <span style={{ fontSize: 11, color: value ? "#21714b" : "#6b7280" }}>
          {value ? "Signature saved" : "No signature · optional"}
        </span>
      </div>
      {value && (
        <>
          <div
            style={{
              marginTop: 10,
              borderRadius: 8,
              border: "1px solid #e7e8ee",
              padding: 8,
              background:
                "repeating-conic-gradient(#f4f4f8 0% 25%,white 0% 50%) 0/16px 16px",
            }}
          >
            <img
              src={processedUrl}
              alt={`${label} of ${value.signerName}`}
              style={{ width: "100%", height: 90, objectFit: "contain" }}
            />
            <small style={{ color: "#6b7280" }}>
              After cleanup · transparent PNG
            </small>
          </div>
          <details style={{ fontSize: 12, marginTop: 8 }}>
            <summary>Before cleanup · original evidence</summary>
            <img
              src={originalUrl}
              alt="Original signature evidence before cleanup"
              style={{ width: "100%", maxHeight: 180, objectFit: "contain" }}
            />
          </details>
        </>
      )}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={`Photograph ${label.toLowerCase()}`}
        hidden
        onChange={(e) => void choosePhoto(e.target.files?.[0])}
      />
      <input
        ref={uploadInput}
        type="file"
        accept="image/*"
        aria-label={`Upload ${label.toLowerCase()}`}
        hidden
        onChange={(e) => void choosePhoto(e.target.files?.[0])}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={busy}
          onClick={() => cameraInput.current?.click()}
        >
          <Camera size={15} />
          {value ? "Retake" : "Scan paper"}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={busy}
          onClick={() => uploadInput.current?.click()}
        >
          <Upload size={15} />
          Upload
        </button>
        {typeof navigator !== "undefined" &&
          !!navigator.mediaDevices?.getUserMedia && (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy || cameraOpen}
              onClick={() => void openCamera()}
            >
              <Camera size={15} />
              Live camera
            </button>
          )}
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            setError("");
            setMode("draw");
          }}
        >
          <PenLine size={15} />
          Draw
        </button>
        {value && (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => {
              onChange(undefined);
              setMode("closed");
            }}
          >
            <Trash2 size={15} />
            Remove
          </button>
        )}
      </div>
      {cameraOpen && (
        <div style={{ marginTop: 12 }}>
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            aria-label="Live paper signature camera"
            style={{
              width: "100%",
              borderRadius: 8,
              maxHeight: 320,
              background: "#111827",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => void captureCamera()}
            >
              <Camera size={15} />
              Take photo
            </button>
            <button type="button" style={buttonStyle} onClick={stopCamera}>
              <X size={15} />
              Close camera
            </button>
          </div>
        </div>
      )}
      {mode === "photo" && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
            {perspective
              ? "Drag the four handles to the corners of the signature box to straighten the photo."
              : "Drag a box around the signature. Keep handwriting inside the highlighted area."}
          </p>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            <canvas
              ref={photoCanvas}
              role="img"
              aria-label="Photo crop preview. Use the crop inset slider for keyboard cropping."
              style={{
                display: "block",
                width: "100%",
                borderRadius: 8,
                touchAction: "none",
                cursor: "crosshair",
              }}
              onPointerDown={cropStart}
              onPointerMove={cropMove}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            />
          </div>
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 12,
              marginTop: 10,
            }}
          >
            Crop inset
            <input
              aria-label="Crop inset"
              type="range"
              min="0"
              max="45"
              defaultValue="8"
              onChange={(e) => {
                if (source.current)
                  setCorners(
                    cropCorners(
                      source.current.width,
                      source.current.height,
                      Number(e.target.value) / 100,
                    ),
                  );
              }}
              style={{ flex: 1 }}
            />
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                if (!source.current) return;
                source.current = rotateCanvas(source.current);
                setCorners(
                  cropCorners(source.current.width, source.current.height),
                );
                setSourceVersion((v) => v + 1);
              }}
            >
              <RotateCw size={15} />
              Rotate
            </button>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                checked={perspective}
                onChange={(e) => setPerspective(e.target.checked)}
              />
              Perspective correction
            </label>
          </div>
          {originalUrl && (
            <details style={{ fontSize: 12, marginTop: 8 }}>
              <summary>Original evidence photo</summary>
              <img
                src={originalUrl}
                alt="Original signature evidence before cleanup"
                style={{ width: "100%", maxHeight: 180, objectFit: "contain" }}
              />
            </details>
          )}
        </div>
      )}
      {mode === "draw" && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: "#6b7280" }}>
            Sign with a finger, mouse, or Apple Pencil.
          </p>
          <canvas
            ref={drawCanvas}
            width={1000}
            height={360}
            aria-label="Draw signature here"
            style={{
              display: "block",
              width: "100%",
              background: "#fff",
              border: "1px dashed #aeb1c6",
              borderRadius: 8,
              touchAction: "none",
            }}
            onPointerDown={drawStart}
            onPointerMove={drawMove}
            onPointerUp={drawEnd}
            onPointerCancel={drawEnd}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              style={buttonStyle}
              disabled={!strokeCount}
              onClick={() => {
                const previous = history.current.pop();
                if (previous)
                  drawCanvas.current
                    ?.getContext("2d")
                    ?.putImageData(previous, 0, 0);
                setStrokeCount(history.current.length);
              }}
            >
              <Undo2 size={15} />
              Undo
            </button>
            <button type="button" style={buttonStyle} onClick={clearDraw}>
              <Trash2 size={15} />
              Clear
            </button>
          </div>
        </div>
      )}
      {mode !== "closed" && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            style={{
              ...buttonStyle,
              background: "#5b5cff",
              color: "#fff",
              borderColor: "#5b5cff",
            }}
            disabled={busy || (mode === "draw" && !strokeCount)}
            onClick={() => void save()}
          >
            <Check size={15} />
            {busy
              ? "Processing…"
              : mode === "photo"
                ? "Clean & use signature"
                : "Use signature"}
          </button>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => {
              setMode("closed");
              setError("");
            }}
          >
            <X size={15} />
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          style={{ color: "#b23742", fontSize: 12, marginTop: 8 }}
        >
          {error}
        </p>
      )}
      {busy && mode === "closed" && (
        <p role="status" style={{ fontSize: 12 }}>
          Opening photo…
        </p>
      )}
    </div>
  );
}
