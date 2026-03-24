import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Download, Link2, Copy, Check, FolderOpen, Play, Pause, Scissors, Crop, X, RotateCcw, ZoomIn, ZoomOut, SkipBack, SkipForward, Maximize2 } from "lucide-react";
import MtpImagePicker from "@/components/mtp-image-picker";
import StructuredFilenameDialog from "@/components/image-generator/structured-filename-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SavedVideo } from "@shared/schema";

interface CropState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
  startX: number;
  startY: number;
  startCrop: CropState;
}

function CropOverlay({
  videoWidth,
  videoHeight,
  containerWidth,
  containerHeight,
  crop,
  onCropChange,
  onApply,
  onCancel,
}: {
  videoWidth: number;
  videoHeight: number;
  containerWidth: number;
  containerHeight: number;
  crop: CropState;
  onCropChange: (crop: CropState) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const videoAspect = videoWidth / videoHeight;
  const containerAspect = containerWidth / containerHeight;
  let displayW: number, displayH: number, offsetX: number, offsetY: number;
  if (videoAspect > containerAspect) {
    displayW = containerWidth;
    displayH = containerWidth / videoAspect;
    offsetX = 0;
    offsetY = (containerHeight - displayH) / 2;
  } else {
    displayH = containerHeight;
    displayW = containerHeight * videoAspect;
    offsetX = (containerWidth - displayW) / 2;
    offsetY = 0;
  }

  const scaleX = displayW / videoWidth;
  const scaleY = displayH / videoHeight;

  const screenCrop = {
    x: offsetX + crop.x * scaleX,
    y: offsetY + crop.y * scaleY,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
  };

  const handleSize = 10;

  const clampCrop = useCallback((c: CropState): CropState => {
    const minSize = 20;
    let { x, y, width, height } = c;
    width = Math.max(minSize, Math.min(width, videoWidth));
    height = Math.max(minSize, Math.min(height, videoHeight));
    x = Math.max(0, Math.min(x, videoWidth - width));
    y = Math.max(0, Math.min(y, videoHeight - height));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }, [videoWidth, videoHeight]);

  const handleMouseDown = useCallback((e: React.MouseEvent, type: DragState['type']) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      type,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
    });
  }, [crop]);

  useEffect(() => {
    if (!dragState) return;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragState.startX) / scaleX;
      const dy = (e.clientY - dragState.startY) / scaleY;
      const sc = dragState.startCrop;
      let newCrop: CropState;
      switch (dragState.type) {
        case 'move':
          newCrop = { ...sc, x: sc.x + dx, y: sc.y + dy };
          break;
        case 'nw':
          newCrop = { x: sc.x + dx, y: sc.y + dy, width: sc.width - dx, height: sc.height - dy };
          break;
        case 'ne':
          newCrop = { x: sc.x, y: sc.y + dy, width: sc.width + dx, height: sc.height - dy };
          break;
        case 'sw':
          newCrop = { x: sc.x + dx, y: sc.y, width: sc.width - dx, height: sc.height + dy };
          break;
        case 'se':
          newCrop = { x: sc.x, y: sc.y, width: sc.width + dx, height: sc.height + dy };
          break;
        case 'n':
          newCrop = { x: sc.x, y: sc.y + dy, width: sc.width, height: sc.height - dy };
          break;
        case 's':
          newCrop = { ...sc, height: sc.height + dy };
          break;
        case 'w':
          newCrop = { x: sc.x + dx, y: sc.y, width: sc.width - dx, height: sc.height };
          break;
        case 'e':
          newCrop = { ...sc, width: sc.width + dx };
          break;
        default:
          newCrop = sc;
      }
      onCropChange(clampCrop(newCrop));
    };
    const handleMouseUp = () => setDragState(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, scaleX, scaleY, clampCrop, onCropChange]);

  const handles: { type: DragState['type']; x: number; y: number; cursor: string }[] = [
    { type: 'nw', x: screenCrop.x, y: screenCrop.y, cursor: 'nwse-resize' },
    { type: 'ne', x: screenCrop.x + screenCrop.width, y: screenCrop.y, cursor: 'nesw-resize' },
    { type: 'sw', x: screenCrop.x, y: screenCrop.y + screenCrop.height, cursor: 'nesw-resize' },
    { type: 'se', x: screenCrop.x + screenCrop.width, y: screenCrop.y + screenCrop.height, cursor: 'nwse-resize' },
    { type: 'n', x: screenCrop.x + screenCrop.width / 2, y: screenCrop.y, cursor: 'ns-resize' },
    { type: 's', x: screenCrop.x + screenCrop.width / 2, y: screenCrop.y + screenCrop.height, cursor: 'ns-resize' },
    { type: 'w', x: screenCrop.x, y: screenCrop.y + screenCrop.height / 2, cursor: 'ew-resize' },
    { type: 'e', x: screenCrop.x + screenCrop.width, y: screenCrop.y + screenCrop.height / 2, cursor: 'ew-resize' },
  ];

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10"
      style={{ cursor: dragState ? 'grabbing' : undefined }}
      data-testid="crop-overlay"
    >
      <svg width={containerWidth} height={containerHeight} className="absolute inset-0">
        <defs>
          <mask id="cropMask">
            <rect x={0} y={0} width={containerWidth} height={containerHeight} fill="white" />
            <rect
              x={screenCrop.x}
              y={screenCrop.y}
              width={screenCrop.width}
              height={screenCrop.height}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x={0} y={0}
          width={containerWidth}
          height={containerHeight}
          fill="rgba(0,0,0,0.55)"
          mask="url(#cropMask)"
        />
        <rect
          x={screenCrop.x}
          y={screenCrop.y}
          width={screenCrop.width}
          height={screenCrop.height}
          fill="transparent"
          stroke="white"
          strokeWidth={2}
          strokeDasharray="6 3"
          style={{ cursor: 'move' }}
          onMouseDown={(e) => handleMouseDown(e as any, 'move')}
        />
        <line x1={screenCrop.x + screenCrop.width / 3} y1={screenCrop.y} x2={screenCrop.x + screenCrop.width / 3} y2={screenCrop.y + screenCrop.height} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        <line x1={screenCrop.x + (screenCrop.width * 2) / 3} y1={screenCrop.y} x2={screenCrop.x + (screenCrop.width * 2) / 3} y2={screenCrop.y + screenCrop.height} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        <line x1={screenCrop.x} y1={screenCrop.y + screenCrop.height / 3} x2={screenCrop.x + screenCrop.width} y2={screenCrop.y + screenCrop.height / 3} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        <line x1={screenCrop.x} y1={screenCrop.y + (screenCrop.height * 2) / 3} x2={screenCrop.x + screenCrop.width} y2={screenCrop.y + (screenCrop.height * 2) / 3} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
      </svg>
      {handles.map((h) => (
        <div
          key={h.type}
          className="absolute bg-white border-2 border-primary rounded-sm z-20"
          style={{
            width: handleSize,
            height: handleSize,
            left: h.x - handleSize / 2,
            top: h.y - handleSize / 2,
            cursor: h.cursor,
          }}
          onMouseDown={(e) => handleMouseDown(e, h.type)}
          data-testid={`crop-handle-${h.type}`}
        />
      ))}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-2">
        <Button size="sm" onClick={onApply} data-testid="button-crop-apply">
          <Check className="mr-1 h-3 w-3" />
          Apply Crop
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="bg-background/80" data-testid="button-crop-cancel">
          <X className="mr-1 h-3 w-3" />
          Cancel
        </Button>
      </div>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
        <Badge variant="secondary" className="text-xs font-mono">
          {crop.width} x {crop.height}
        </Badge>
      </div>
    </div>
  );
}

function Timeline({
  duration,
  startTime,
  endTime,
  currentTime,
  isPlaying,
  onStartTimeChange,
  onEndTimeChange,
  onSeek,
  onPlayPause,
  onSplit,
  zoom,
  onZoomIn,
  onZoomOut,
}: {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  isPlaying: boolean;
  onStartTimeChange: (t: number) => void;
  onEndTimeChange: (t: number) => void;
  onSeek: (t: number) => void;
  onPlayPause: () => void;
  onSplit: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | 'playhead' | null>(null);

  const formatTime = (t: number) => {
    const mins = Math.floor(t / 60);
    const secs = t % 60;
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  };

  const getTimeFromX = useCallback((clientX: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return fraction * duration;
  }, [duration]);

  const wasPlayingRef = useRef(false);

  const handleTrackMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const t = getTimeFromX(e.clientX);
    onSeek(t);
    setDragging('playhead');
    e.preventDefault();
  }, [getTimeFromX, onSeek]);

  useEffect(() => {
    if (!dragging) return;
    if (dragging === 'playhead') {
      wasPlayingRef.current = isPlaying;
      if (isPlaying) onPlayPause();
    }
    let lastSeekTime = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastSeekTime < 30) return;
      lastSeekTime = now;
      const t = getTimeFromX(e.clientX);
      if (dragging === 'start') {
        onStartTimeChange(Math.max(0, Math.min(t, endTime - 0.1)));
      } else if (dragging === 'end') {
        onEndTimeChange(Math.min(duration, Math.max(t, startTime + 0.1)));
      } else if (dragging === 'playhead') {
        onSeek(Math.max(0, Math.min(t, duration)));
      }
    };
    const handleMouseUp = () => {
      if (dragging === 'playhead' && wasPlayingRef.current) {
        onPlayPause();
      }
      setDragging(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, getTimeFromX, startTime, endTime, duration, isPlaying, onStartTimeChange, onEndTimeChange, onSeek, onPlayPause]);

  const startPct = duration > 0 ? (startTime / duration) * 100 : 0;
  const endPct = duration > 0 ? (endTime / duration) * 100 : 100;
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const tickCount = Math.max(2, Math.floor(duration * zoom));
  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const arr: number[] = [];
    const count = Math.max(1, Math.min(tickCount, 20));
    const step = duration / count;
    if (step <= 0) return [0];
    for (let t = 0; t <= duration; t += step) arr.push(t);
    if (arr[arr.length - 1] < duration - 0.01) arr.push(duration);
    return arr;
  }, [duration, tickCount]);

  if (duration <= 0) return null;

  return (
    <div className="space-y-2" data-testid="timeline-container">
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => onSeek(startTime)} data-testid="button-skip-start">
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => { if (!isPlaying) onPlayPause(); }} disabled={isPlaying} data-testid="button-play">
            <Play className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => { if (isPlaying) onPlayPause(); }} disabled={!isPlaying} data-testid="button-pause">
            <Pause className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => onSeek(endTime)} data-testid="button-skip-end">
            <SkipForward className="h-4 w-4" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground ml-2" data-testid="text-current-time">
            {formatTime(currentTime)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={onSplit} title="Trim to playhead (S)" data-testid="button-split">
            <Scissors className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onZoomOut} data-testid="button-zoom-out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">{zoom}x</span>
          <Button size="icon" variant="ghost" onClick={onZoomIn} data-testid="button-zoom-in">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative px-1">
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono mb-1 select-none">
          {ticks.map((t, i) => (
            <span key={i}>{formatTime(t)}</span>
          ))}
        </div>

        <div
          ref={trackRef}
          className="relative h-12 bg-muted rounded-md cursor-pointer select-none overflow-hidden"
          onMouseDown={handleTrackMouseDown}
          data-testid="timeline-track"
        >
          <div
            className="absolute top-0 bottom-0 bg-primary/20 border-y-2 border-primary/40"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
            data-testid="timeline-selected-range"
          />

          <div
            className="absolute top-0 bottom-0 w-0 border-l-2 border-red-500 z-10"
            style={{ left: `${playheadPct}%` }}
            data-testid="timeline-playhead"
          >
            <div
              className="absolute -top-0.5 -left-[5px] w-[10px] h-2 bg-red-500 rounded-b-sm cursor-col-resize"
              onMouseDown={(e) => { e.stopPropagation(); setDragging('playhead'); }}
            />
          </div>

          <div
            className="absolute top-0 bottom-0 w-3 bg-primary/80 rounded-l-sm cursor-ew-resize flex items-center justify-center z-10 hover:bg-primary"
            style={{ left: `calc(${startPct}% - 6px)` }}
            onMouseDown={(e) => { e.stopPropagation(); setDragging('start'); }}
            data-testid="trim-handle-start"
          >
            <div className="w-0.5 h-4 bg-white rounded-full" />
          </div>

          <div
            className="absolute top-0 bottom-0 w-3 bg-primary/80 rounded-r-sm cursor-ew-resize flex items-center justify-center z-10 hover:bg-primary"
            style={{ left: `calc(${endPct}% - 6px)` }}
            onMouseDown={(e) => { e.stopPropagation(); setDragging('end'); }}
            data-testid="trim-handle-end"
          >
            <div className="w-0.5 h-4 bg-white rounded-full" />
          </div>
        </div>

        <div className="flex items-center justify-between mt-1">
          <span className="text-xs font-mono text-muted-foreground" data-testid="text-trim-range">
            Trim: {formatTime(startTime)} - {formatTime(endTime)} ({(endTime - startTime).toFixed(1)}s)
          </span>
          <span className="text-xs text-muted-foreground">
            Total: {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function GifCreator() {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropRafRef = useRef<number>(0);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [serverVideoUrl, setServerVideoUrl] = useState<string>("");
  const [selectedVideoId, setSelectedVideoId] = useState<string>("none");

  const [quality, setQuality] = useState<number>(80);
  const [fps, setFps] = useState<number>(15);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoNativeWidth, setVideoNativeWidth] = useState<number>(0);
  const [videoNativeHeight, setVideoNativeHeight] = useState<number>(0);
  const [scale, setScale] = useState<number>(100);
  const [infiniteLoop, setInfiniteLoop] = useState<boolean>(true);
  const [loopCount, setLoopCount] = useState<number>(3);
  const [estimatedGifSize, setEstimatedGifSize] = useState<number>(0);
  const [estimatedWebpSize, setEstimatedWebpSize] = useState<number>(0);

  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<CropState>({ x: 0, y: 0, width: 0, height: 0 });
  const [appliedCrop, setAppliedCrop] = useState<CropState | null>(null);

  const [videoReady, setVideoReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const [gifResult, setGifResult] = useState<{ url: string; fileSize: number } | null>(null);
  const [webpResult, setWebpResult] = useState<{ url: string; fileSize: number } | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const [mtpStructuredOpen, setMtpStructuredOpen] = useState(false);
  const [mtpPendingUpload, setMtpPendingUpload] = useState<{ format: 'gif' | 'webp'; url: string } | null>(null);
  const [mtpSuccessDialog, setMtpSuccessDialog] = useState(false);
  const [mtpUploadedLink, setMtpUploadedLink] = useState<string | null>(null);
  const [mtpLinkCopied, setMtpLinkCopied] = useState(false);
  const [mtpVideoPickerOpen, setMtpVideoPickerOpen] = useState(false);

  const { data: videosData } = useQuery<{ success: boolean; videos: SavedVideo[] }>({
    queryKey: ["/api/saved-videos"],
  });
  const savedVideos = videosData?.videos || [];

  useEffect(() => {
    if (!videoContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(videoContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const CHUNKED_UPLOAD_THRESHOLD = 20 * 1024 * 1024;
      const CHUNK_SIZE = 5 * 1024 * 1024;

      if (file.size > CHUNKED_UPLOAD_THRESHOLD) {
        const sessionResponse = await apiRequest('POST', '/api/gif-conversions/chunked-upload/session', {
          filename: file.name,
          contentType: file.type,
        });
        const sessionData = await sessionResponse.json();

        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        let finalStorageUrl = '';

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const isLastChunk = i === totalChunks - 1;

          const chunkResponse = await fetch(
            `/api/gif-conversions/chunked-upload/chunk?sessionId=${sessionData.sessionId}&chunkIndex=${i}&isLastChunk=${isLastChunk}&filename=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type)}`,
            { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk }
          );

          if (!chunkResponse.ok) throw new Error(`Chunk ${i + 1} upload failed`);

          if (isLastChunk) {
            const chunkData = await chunkResponse.json();
            if (chunkData.sessionId && chunkData.localUpload) {
              finalStorageUrl = `session:${chunkData.sessionId}`;
            } else {
              throw new Error('Failed to get session ID from chunked upload');
            }
          }
        }

        if (!finalStorageUrl) throw new Error('Failed to get session ID from upload');
        return { success: true, videoUrl: finalStorageUrl };
      }

      const formData = new FormData();
      formData.append('video', file);
      const response = await fetch('/api/gif-conversions/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to upload video' }));
        throw new Error(errorData.details || errorData.error || 'Failed to upload video');
      }
      return await response.json();
    },
    onSuccess: (data: { success: boolean; videoUrl: string }) => {
      setServerVideoUrl(data.videoUrl);
      toast({ title: "Upload successful", description: "Video uploaded and ready for conversion" });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      resetEditorState();
      setVideoFile(file);
      setSelectedVideoId("none");
      const blobUrl = URL.createObjectURL(file);
      setVideoUrl(blobUrl);
      uploadMutation.mutate(file);
    }
  };

  const handleSavedVideoSelect = async (videoId: string) => {
    if (videoId === "none") {
      setSelectedVideoId("none");
      setVideoUrl("");
      setServerVideoUrl("");
      return;
    }
    const video = savedVideos.find(v => v.id === videoId);
    if (video) {
      resetEditorState();
      setSelectedVideoId(videoId);
      setServerVideoUrl(video.url);
      setVideoFile(null);
      try {
        const response = await fetch(video.url);
        if (response.ok) {
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          setVideoUrl(blobUrl);
        } else {
          setVideoUrl(video.url);
        }
      } catch {
        setVideoUrl(video.url);
      }
    }
  };

  const handleMtpVideoSelect = async (video: { url: string; key: string }) => {
    try {
      const proxyUrl = `/api/mtp-images/proxy/${encodeURIComponent(video.key)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch video');
      const blob = await response.blob();
      const filename = video.key.split('/').pop() || 'mtp-video.mp4';
      const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);
      resetEditorState();
      setVideoUrl(blobUrl);
      setVideoFile(file);
      setSelectedVideoId("none");
      uploadMutation.mutate(file);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load video from MTP library", variant: "destructive" });
    }
  };

  const resetEditorState = () => {
    setCropMode(false);
    setAppliedCrop(null);
    setCrop({ x: 0, y: 0, width: 0, height: 0 });
    setGifResult(null);
    setWebpResult(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setVideoReady(false);
  };

  useEffect(() => {
    if (videoRef.current && videoUrl) {
      const video = videoRef.current;
      setVideoReady(false);
      const handleLoadedMetadata = () => {
        setVideoDuration(video.duration);
        setEndTime(video.duration);
        setVideoNativeWidth(video.videoWidth);
        setVideoNativeHeight(video.videoHeight);
        setCrop({ x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
      };
      const handleCanPlay = () => {
        setVideoReady(true);
      };
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      video.addEventListener("canplay", handleCanPlay);
      if (video.readyState >= 3) {
        setVideoReady(true);
      }
      return () => {
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        video.removeEventListener("canplay", handleCanPlay);
      };
    }
  }, [videoUrl]);

  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      video.currentTime = startTime;
      setCurrentTime(startTime);
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [startTime, videoUrl]);

  useEffect(() => {
    if (videoRef.current && isPlaying && currentTime >= endTime) {
      videoRef.current.pause();
      videoRef.current.currentTime = startTime;
      setCurrentTime(startTime);
      setIsPlaying(false);
    }
  }, [currentTime, endTime, isPlaying, startTime]);

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      if (currentTime >= endTime || currentTime < startTime) {
        videoRef.current.currentTime = startTime;
      }
      videoRef.current.play();
    }
  }, [isPlaying, currentTime, startTime, endTime]);

  const handleSeek = useCallback((t: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = t;
    setCurrentTime(t);
  }, []);

  const handleSplit = useCallback(() => {
    if (currentTime > startTime && currentTime < endTime) {
      toast({
        title: "Trimmed at playhead",
        description: `End point set to ${currentTime.toFixed(1)}s`,
      });
      setEndTime(currentTime);
    }
  }, [currentTime, startTime, endTime, toast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleSplit();
      }
      if (e.key === ' ') {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSplit, handlePlayPause]);

  const enterCropMode = () => {
    if (!videoReady) return;
    if (appliedCrop) {
      setCrop({ ...appliedCrop });
    } else {
      setCrop({ x: 0, y: 0, width: videoNativeWidth, height: videoNativeHeight });
    }
    if (videoContainerRef.current && containerSize.width === 0) {
      const rect = videoContainerRef.current.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    }
    setCropMode(true);
  };

  const applyCrop = () => {
    const isFullFrame = crop.x === 0 && crop.y === 0 &&
      crop.width === videoNativeWidth && crop.height === videoNativeHeight;
    setAppliedCrop(isFullFrame ? null : crop);
    setCropMode(false);
    toast({ title: isFullFrame ? "Crop reset" : "Crop applied", description: isFullFrame ? "Using full video frame" : `Cropped to ${crop.width}x${crop.height}` });
  };

  const cancelCrop = () => {
    setCropMode(false);
  };

  const resetCrop = () => {
    setAppliedCrop(null);
    setCrop({ x: 0, y: 0, width: videoNativeWidth, height: videoNativeHeight });
    toast({ title: "Crop reset", description: "Using full video frame" });
  };

  const effectiveCropWidth = appliedCrop ? appliedCrop.width : videoNativeWidth;
  const effectiveCropHeight = appliedCrop ? appliedCrop.height : videoNativeHeight;

  const showCropCanvas = !!appliedCrop && !cropMode && videoNativeWidth > 0;

  useEffect(() => {
    cancelAnimationFrame(cropRafRef.current);
    cropRafRef.current = 0;

    if (!showCropCanvas) return;
    const video = videoRef.current;
    const canvas = cropCanvasRef.current;
    if (!video || !canvas || !appliedCrop) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastDrawnTime = -1;

    const drawCroppedFrame = () => {
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        cropRafRef.current = requestAnimationFrame(drawCroppedFrame);
        return;
      }

      const cw = canvas.clientWidth || containerSize.width;
      if (cw <= 0) { cropRafRef.current = requestAnimationFrame(drawCroppedFrame); return; }
      const cropAspect = appliedCrop.width / appliedCrop.height;
      const ch = Math.round(cw / cropAspect);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      const now = video.currentTime;
      if (now !== lastDrawnTime || lastDrawnTime === -1) {
        ctx.drawImage(
          video,
          appliedCrop.x, appliedCrop.y, appliedCrop.width, appliedCrop.height,
          0, 0, cw, ch
        );
        lastDrawnTime = now;
      }

      cropRafRef.current = requestAnimationFrame(drawCroppedFrame);
    };
    cropRafRef.current = requestAnimationFrame(drawCroppedFrame);
    return () => { cancelAnimationFrame(cropRafRef.current); cropRafRef.current = 0; };
  }, [showCropCanvas, appliedCrop, containerSize.width]);

  const estimateMutation = useMutation({
    mutationFn: async () => {
      if (!serverVideoUrl) throw new Error("Please select or upload a video first");
      const scaledWidth = scale < 100 ? Math.round(effectiveCropWidth * (scale / 100)) : undefined;
      const scaledHeight = scale < 100 ? Math.round(effectiveCropHeight * (scale / 100)) : undefined;
      const params: any = {
        sourceVideoUrl: serverVideoUrl,
        width: scaledWidth,
        height: scaledHeight,
        startTime,
        endTime,
        quality,
        fps,
        loop: infiniteLoop ? 0 : loopCount,
      };
      if (appliedCrop) {
        params.cropX = appliedCrop.x;
        params.cropY = appliedCrop.y;
        params.cropWidth = appliedCrop.width;
        params.cropHeight = appliedCrop.height;
      }
      const response = await apiRequest("POST", "/api/gif-conversions/estimate", params);
      return response.json();
    },
    onSuccess: (data: any) => {
      setEstimatedGifSize(data.estimatedGifSize);
      setEstimatedWebpSize(data.estimatedWebpSize);
    },
    onError: (error: Error) => {
      toast({ title: "Estimation failed", description: error.message, variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!serverVideoUrl) throw new Error("Please select or upload a video first");
      const scaledWidth = scale < 100 ? Math.round(effectiveCropWidth * (scale / 100)) : undefined;
      const scaledHeight = scale < 100 ? Math.round(effectiveCropHeight * (scale / 100)) : undefined;
      const params: any = {
        sourceVideoUrl: serverVideoUrl,
        width: scaledWidth,
        height: scaledHeight,
        startTime,
        endTime,
        quality,
        fps,
        loop: infiniteLoop ? 0 : loopCount,
      };
      if (appliedCrop) {
        params.cropX = appliedCrop.x;
        params.cropY = appliedCrop.y;
        params.cropWidth = appliedCrop.width;
        params.cropHeight = appliedCrop.height;
      }
      const controller = new AbortController();
      setAbortController(controller);
      const response = await fetch("/api/gif-conversions/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || "Conversion failed");
      }
      const data = await response.json();
      setAbortController(null);
      return data;
    },
    onSuccess: (data: any) => {
      setGifResult({ url: data.gifResult.url, fileSize: data.gifResult.fileSize || 0 });
      setWebpResult({ url: data.webpResult.url, fileSize: data.webpResult.fileSize || 0 });
      toast({ title: "Conversions complete!", description: "Your GIF and WebP are ready." });
      queryClient.invalidateQueries({ queryKey: ["/api/gif-conversions"] });
    },
    onError: (error: Error) => {
      setAbortController(null);
      if (error.name === 'AbortError') {
        toast({ title: "Conversion cancelled", description: "The conversion was stopped" });
      } else {
        toast({ title: "Conversion failed", description: error.message, variant: "destructive" });
      }
    },
  });

  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  };

  useEffect(() => {
    if (serverVideoUrl && videoDuration > 0) {
      const debounce = setTimeout(() => estimateMutation.mutate(), 500);
      return () => clearTimeout(debounce);
    }
  }, [serverVideoUrl, quality, fps, startTime, endTime, appliedCrop, scale]);

  const handleDownload = (url: string, format: 'gif' | 'webp') => {
    const link = document.createElement("a");
    link.href = url;
    link.download = `converted.${format}`;
    link.click();
  };

  const mtpUploadMutation = useMutation({
    mutationFn: async ({ url, filename, format, folderId }: { url: string; filename: string; format: 'gif' | 'webp'; folderId?: number }) => {
      const response = await fetch(url);
      const blob = await response.blob();
      const formData = new FormData();
      formData.append('file', blob, `${filename}.${format}`);
      formData.append('filename', `${filename}.${format}`);
      if (folderId !== undefined) {
        formData.append('folderId', String(folderId));
      }
      const uploadResponse = await fetch('/api/mtp-images/upload', { method: 'POST', body: formData });
      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || 'Failed to upload to MTP-Images');
      }
      return uploadResponse.json();
    },
    onSuccess: (data) => {
      setMtpUploadedLink(data.url);
      setMtpLinkCopied(false);
      setMtpSuccessDialog(true);
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-images'] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const openMtpUploadDialog = (format: 'gif' | 'webp', url: string) => {
    setMtpUploadedLink(null);
    setMtpLinkCopied(false);
    setMtpPendingUpload({ format, url });
    setMtpStructuredOpen(true);
  };

  const handleMtpStructuredSave = (filename: string, folderId?: number) => {
    if (!mtpPendingUpload) return;
    setMtpStructuredOpen(false);
    mtpUploadMutation.mutate({ url: mtpPendingUpload.url, filename, format: mtpPendingUpload.format, folderId });
  };

  const copyMtpLink = async () => {
    if (mtpUploadedLink) {
      await navigator.clipboard.writeText(mtpUploadedLink);
      setMtpLinkCopied(true);
      toast({ title: "Link copied!", description: "The link has been copied to your clipboard." });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">GIF & WebP Creator</h1>
        <p className="text-muted-foreground">Convert videos to animated GIFs or WebP files with visual cropping and trimming</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="font-semibold">Video Source:</Label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  disabled={uploadMutation.isPending}
                  className="hidden"
                  id="video-upload-input"
                  data-testid="input-upload-video"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('video-upload-input')?.click()}
                  disabled={uploadMutation.isPending}
                  data-testid="button-upload-video"
                >
                  <Upload className="mr-1 h-3 w-3" />
                  Upload
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMtpVideoPickerOpen(true)}
                  data-testid="button-browse-mtp-video"
                >
                  <FolderOpen className="mr-1 h-3 w-3" />
                  MTP Library
                </Button>
                <Select value={selectedVideoId} onValueChange={handleSavedVideoSelect}>
                  <SelectTrigger className="w-[200px]" data-testid="select-saved-video">
                    <SelectValue placeholder="Saved videos..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {savedVideos.map((video) => (
                      <SelectItem key={video.id} value={video.id}>
                        {video.prompt.substring(0, 40)}...
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {uploadMutation.isPending && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {videoUrl ? (
            <>
              <Card>
                <CardContent className="p-0">
                  <div
                    ref={videoContainerRef}
                    className="relative bg-black rounded-t-lg overflow-hidden"
                    style={{ minHeight: '300px', maxHeight: '500px' }}
                    onDoubleClick={() => { if (!cropMode && videoReady) enterCropMode(); }}
                    data-testid="video-canvas-area"
                  >
                    <video
                      key={videoUrl}
                      ref={videoRef}
                      src={videoUrl}
                      className="w-full h-full object-contain"
                      style={{ maxHeight: '500px', display: showCropCanvas ? 'none' : 'block' }}
                      crossOrigin="anonymous"
                      data-testid="video-preview"
                    />
                    {showCropCanvas && (
                      <canvas
                        ref={cropCanvasRef}
                        className="w-full object-contain"
                        style={{ maxHeight: '500px' }}
                        data-testid="crop-preview-canvas"
                      />
                    )}
                    {cropMode && containerSize.width > 0 && (
                      <CropOverlay
                        videoWidth={videoNativeWidth}
                        videoHeight={videoNativeHeight}
                        containerWidth={containerSize.width}
                        containerHeight={containerSize.height}
                        crop={crop}
                        onCropChange={setCrop}
                        onApply={applyCrop}
                        onCancel={cancelCrop}
                      />
                    )}
                  </div>
                  <div className="p-3 border-t flex items-center gap-2 flex-wrap">
                    <Button
                      variant={cropMode ? "default" : appliedCrop ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => cropMode ? cancelCrop() : enterCropMode()}
                      disabled={!videoReady && !cropMode}
                      data-testid="button-crop-toggle"
                    >
                      <Crop className="mr-1 h-3 w-3" />
                      {!videoReady && !cropMode ? "Loading..." : cropMode ? "Exit Crop" : appliedCrop ? "Edit Crop" : "Crop"}
                    </Button>
                    {cropMode && (
                      <Button variant="default" size="sm" onClick={applyCrop} data-testid="button-crop-apply-inline">
                        <Check className="mr-1 h-3 w-3" />
                        Apply
                      </Button>
                    )}
                    {appliedCrop && !cropMode && (
                      <Button variant="ghost" size="sm" onClick={resetCrop} data-testid="button-crop-reset">
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Reset
                      </Button>
                    )}
                    <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      {videoNativeWidth > 0 && (
                        <Badge variant="outline" className="font-mono text-xs" data-testid="badge-dimensions">
                          {appliedCrop ? `${appliedCrop.width}x${appliedCrop.height}` : `${videoNativeWidth}x${videoNativeHeight}`}
                          {scale < 100 && ` → ${Math.round(effectiveCropWidth * scale / 100)}x${Math.round(effectiveCropHeight * scale / 100)}`}
                        </Badge>
                      )}
                      {!cropMode && videoReady && (
                        <span className="text-muted-foreground text-[11px]">Double-click video to crop</span>
                      )}
                    </div>
                  </div>
                  {cropMode && (
                    <div className="px-3 pb-3 border-t pt-2 flex items-center gap-1 flex-wrap">
                      <span className="text-xs text-muted-foreground mr-1">Ratio:</span>
                      {[
                        { label: "Free", ratio: null },
                        { label: "1:1", ratio: 1 },
                        { label: "16:9", ratio: 16 / 9 },
                        { label: "9:16", ratio: 9 / 16 },
                        { label: "4:3", ratio: 4 / 3 },
                        { label: "3:4", ratio: 3 / 4 },
                      ].map((preset) => (
                        <Button
                          key={preset.label}
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-2"
                          onClick={() => {
                            if (!preset.ratio) {
                              setCrop({ x: 0, y: 0, width: videoNativeWidth, height: videoNativeHeight });
                              return;
                            }
                            const r = preset.ratio;
                            let w = videoNativeWidth;
                            let h = Math.round(w / r);
                            if (h > videoNativeHeight) {
                              h = videoNativeHeight;
                              w = Math.round(h * r);
                            }
                            w = Math.min(w, videoNativeWidth);
                            h = Math.min(h, videoNativeHeight);
                            const x = Math.round((videoNativeWidth - w) / 2);
                            const y = Math.round((videoNativeHeight - h) / 2);
                            setCrop({ x, y, width: w, height: h });
                          }}
                          data-testid={`button-crop-inline-preset-${preset.label.replace(':', '-')}`}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <Timeline
                    duration={videoDuration}
                    startTime={startTime}
                    endTime={endTime}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    onStartTimeChange={setStartTime}
                    onEndTimeChange={setEndTime}
                    onSeek={handleSeek}
                    onPlayPause={handlePlayPause}
                    onSplit={handleSplit}
                    zoom={timelineZoom}
                    onZoomIn={() => setTimelineZoom(z => Math.min(8, z + 1))}
                    onZoomOut={() => setTimelineZoom(z => Math.max(1, z - 1))}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-20">
                <div className="text-center space-y-3">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground/50" />
                  <p className="text-muted-foreground">Upload a video or select one from your library to get started</p>
                  <Button
                    onClick={() => document.getElementById('video-upload-input')?.click()}
                    data-testid="button-upload-hero"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Video
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {(gifResult || webpResult) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Converted Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {gifResult && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">GIF</h3>
                        <Badge variant="secondary" className="font-mono text-xs">{formatBytes(gifResult.fileSize)}</Badge>
                      </div>
                      <img
                        src={gifResult.url}
                        alt="GIF preview"
                        className="w-full rounded-md border"
                        data-testid="img-gif-preview"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleDownload(gifResult.url, 'gif')}
                          className="flex-1"
                          data-testid="button-download-gif"
                        >
                          <Download className="mr-1 h-3 w-3" />
                          Download
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openMtpUploadDialog('gif', gifResult.url)}
                          className="flex-1"
                          data-testid="button-mtp-gif"
                        >
                          <Link2 className="mr-1 h-3 w-3" />
                          MTP-Images
                        </Button>
                      </div>
                    </div>
                  )}
                  {webpResult && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">WebP</h3>
                        <Badge variant="secondary" className="font-mono text-xs">{formatBytes(webpResult.fileSize)}</Badge>
                      </div>
                      <img
                        src={webpResult.url}
                        alt="WebP preview"
                        className="w-full rounded-md border"
                        data-testid="img-webp-preview"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleDownload(webpResult.url, 'webp')}
                          className="flex-1"
                          data-testid="button-download-webp"
                        >
                          <Download className="mr-1 h-3 w-3" />
                          Download
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openMtpUploadDialog('webp', webpResult.url)}
                          className="flex-1"
                          data-testid="button-mtp-webp"
                        >
                          <Link2 className="mr-1 h-3 w-3" />
                          MTP-Images
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Quality: {quality}%</Label>
                <Slider
                  value={[quality]}
                  onValueChange={([v]) => setQuality(v)}
                  min={1}
                  max={100}
                  step={1}
                  data-testid="slider-quality"
                />
              </div>

              <div className="space-y-2">
                <Label>FPS: {fps}</Label>
                <Slider
                  value={[fps]}
                  onValueChange={([v]) => setFps(v)}
                  min={1}
                  max={30}
                  step={1}
                  data-testid="slider-fps"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Scale: {scale}%
                  {scale < 100 && effectiveCropWidth > 0 && (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({Math.round(effectiveCropWidth * scale / 100)}x{Math.round(effectiveCropHeight * scale / 100)})
                    </span>
                  )}
                </Label>
                <Slider
                  value={[scale]}
                  onValueChange={([v]) => setScale(v)}
                  min={25}
                  max={100}
                  step={5}
                  data-testid="slider-scale"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Loop</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {infiniteLoop ? "Infinite" : `${loopCount}x`}
                    </span>
                    <Switch
                      checked={infiniteLoop}
                      onCheckedChange={setInfiniteLoop}
                      data-testid="switch-infinite-loop"
                    />
                    <span className="text-sm text-muted-foreground">Infinite</span>
                  </div>
                </div>
                {!infiniteLoop && (
                  <Slider
                    value={[loopCount]}
                    onValueChange={([v]) => setLoopCount(v)}
                    min={1}
                    max={20}
                    step={1}
                    data-testid="slider-loop-count"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Estimated Sizes</Label>
                {estimateMutation.isPending ? (
                  <p className="text-sm text-muted-foreground">Estimating...</p>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1 text-center p-2 bg-muted rounded-md">
                      <p className="text-[10px] text-muted-foreground">GIF</p>
                      <p className="text-sm font-semibold">{formatBytes(estimatedGifSize)}</p>
                    </div>
                    <div className="flex-1 text-center p-2 bg-muted rounded-md">
                      <p className="text-[10px] text-muted-foreground">WebP</p>
                      <p className="text-sm font-semibold">{formatBytes(estimatedWebpSize)}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 bg-muted/50 rounded-lg border border-border/50 space-y-1">
                <p className="text-xs font-medium">Tips for smaller files:</p>
                <p className="text-xs text-muted-foreground">Lower FPS, quality, or scale</p>
                <p className="text-xs text-muted-foreground">Trim to shorter duration</p>
                <p className="text-xs text-muted-foreground">Crop to a smaller region</p>
              </div>

              {convertMutation.isPending ? (
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  className="w-full"
                  data-testid="button-cancel"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel Conversion
                </Button>
              ) : (
                <Button
                  onClick={() => convertMutation.mutate()}
                  disabled={!serverVideoUrl || uploadMutation.isPending}
                  className="w-full"
                  data-testid="button-convert"
                >
                  {convertMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Maximize2 className="mr-2 h-4 w-4" />
                  )}
                  Convert to GIF & WebP
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <StructuredFilenameDialog
        open={mtpStructuredOpen}
        onOpenChange={setMtpStructuredOpen}
        onSave={handleMtpStructuredSave}
        isPending={mtpUploadMutation.isPending}
        title={`Add ${mtpPendingUpload?.format?.toUpperCase() || 'File'} to MTP-Images`}
        description="Use the structured naming convention for your file."
      />

      <Dialog
        open={mtpSuccessDialog}
        onOpenChange={(open) => {
          if (!open) { setMtpSuccessDialog(false); setMtpUploadedLink(null); }
        }}
      >
        <DialogContent data-testid="dialog-mtp-success">
          <DialogHeader>
            <DialogTitle>Upload Complete!</DialogTitle>
            <DialogDescription>Your file has been uploaded successfully. Copy the link below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input value={mtpUploadedLink || ""} readOnly className="flex-1" data-testid="input-mtp-link" />
              <Button onClick={copyMtpLink} variant="outline" size="icon" data-testid="button-copy-mtp-link">
                {mtpLinkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button onClick={() => { setMtpSuccessDialog(false); setMtpUploadedLink(null); }} className="w-full" data-testid="button-mtp-done">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <MtpImagePicker
        open={mtpVideoPickerOpen}
        onOpenChange={setMtpVideoPickerOpen}
        onSelect={handleMtpVideoSelect}
        title="Select Video from MTP Library"
        description="Browse your MTP library to select a video for conversion"
        fileType="videos"
      />
    </div>
  );
}
