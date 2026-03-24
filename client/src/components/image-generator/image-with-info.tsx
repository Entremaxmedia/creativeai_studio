import { useState, useEffect, useRef } from "react";

interface ImageWithInfoProps {
  src: string;
  alt: string;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function calculateBase64Size(base64String: string): number {
  const base64Data = base64String.includes(',') 
    ? base64String.split(',')[1] 
    : base64String;
  const padding = (base64Data.match(/=+$/) || [''])[0].length;
  return Math.floor((base64Data.length * 3) / 4) - padding;
}

export function ImageWithInfo({ src, alt, className, onLoad, onError }: ImageWithInfoProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!src) return;

    if (src.startsWith('data:')) {
      const size = calculateBase64Size(src);
      setFileSize(size);
    } else {
      fetch(src, { method: 'HEAD' })
        .then(response => {
          const contentLength = response.headers.get('content-length');
          if (contentLength) {
            setFileSize(parseInt(contentLength, 10));
          }
        })
        .catch(() => {
          fetch(src)
            .then(response => response.blob())
            .then(blob => setFileSize(blob.size))
            .catch(() => {});
        });
    }
  }, [src]);

  const handleImageLoad = () => {
    if (imgRef.current) {
      setDimensions({
        width: imgRef.current.naturalWidth,
        height: imgRef.current.naturalHeight
      });
    }
    onLoad?.();
  };

  return (
    <div className="space-y-1">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        onLoad={handleImageLoad}
        onError={onError}
      />
      {(dimensions || fileSize) && (
        <div className="text-xs text-muted-foreground text-center">
          {dimensions && (
            <span>{dimensions.width} × {dimensions.height}</span>
          )}
          {dimensions && fileSize && <span className="mx-1">•</span>}
          {fileSize && (
            <span>{formatFileSize(fileSize)}</span>
          )}
        </div>
      )}
    </div>
  );
}
