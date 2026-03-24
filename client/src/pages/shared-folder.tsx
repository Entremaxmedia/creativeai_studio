import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Folder, ExternalLink, Copy, Check, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

interface MTPImage {
  key: string;
  size: number;
  lastModified: string;
  url: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface SharedImageCardProps {
  image: MTPImage;
  copiedUrl: string | null;
  onCopyUrl: (url: string) => void;
  formatFileSize: (bytes: number) => string;
  getFileName: (key: string) => string;
}

function SharedImageCard({ image, copiedUrl, onCopyUrl, formatFileSize, getFileName }: SharedImageCardProps) {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = image.url;
  }, [image.url]);

  const getAspectRatioString = (width: number, height: number): string => {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    const w = width / divisor;
    const h = height / divisor;
    if (w > 100 || h > 100) {
      const ratio = width / height;
      if (Math.abs(ratio - 16/9) < 0.01) return "16:9";
      if (Math.abs(ratio - 9/16) < 0.01) return "9:16";
      if (Math.abs(ratio - 4/3) < 0.01) return "4:3";
      if (Math.abs(ratio - 3/4) < 0.01) return "3:4";
      if (Math.abs(ratio - 1) < 0.01) return "1:1";
      return `${ratio.toFixed(2)}:1`;
    }
    return `${w}:${h}`;
  };

  return (
    <Card className="overflow-hidden" data-testid={`shared-image-${image.key}`}>
      <CardContent className="p-0 relative group">
        <img
          src={image.url}
          alt={getFileName(image.key)}
          className="w-full aspect-square object-cover"
          loading="lazy"
        />
        <a
          href={image.url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </CardContent>
      <CardContent className="p-3 space-y-2">
        <p className="text-sm font-medium truncate" title={getFileName(image.key)}>
          {getFileName(image.key)}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span>{formatFileSize(image.size)}</span>
          {dimensions && (
            <>
              <span>•</span>
              <span>{dimensions.width}x{dimensions.height}</span>
              <span>•</span>
              <span>{getAspectRatioString(dimensions.width, dimensions.height)}</span>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onCopyUrl(image.url)}
        >
          {copiedUrl === image.url ? (
            <Check className="mr-1 h-3 w-3" />
          ) : (
            <Copy className="mr-1 h-3 w-3" />
          )}
          {copiedUrl === image.url ? 'Copied' : 'Copy Link'}
        </Button>
      </CardContent>
    </Card>
  );
}

interface MTPFolder {
  id: string;
  name: string;
  parentId: string | null;
  shareCode: string | null;
  createdAt: string;
}

export default function SharedFolderPage() {
  const { shareCode } = useParams();
  const { toast } = useToast();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const { data: folderData, isLoading: folderLoading, error: folderError } = useQuery<{
    success: boolean;
    folder: MTPFolder;
    images: MTPImage[];
    error?: string;
  }>({
    queryKey: ['/api/mtp-folders/share', shareCode],
    queryFn: async () => {
      const response = await fetch(`/api/mtp-folders/share/${shareCode}`);
      return response.json();
    },
  });

  const images = folderData?.images || [];

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      toast({
        title: "Link Copied",
        description: "Image URL copied to clipboard",
      });
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy link to clipboard",
        variant: "destructive",
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileName = (key: string) => {
    return key.split('/').pop() || key;
  };

  if (folderLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Card key={index} className="overflow-hidden">
                <Skeleton className="w-full aspect-square" />
                <CardContent className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (folderError || !folderData?.success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <h1 className="text-xl font-semibold">Folder Not Found</h1>
            <p className="text-muted-foreground">
              This shared folder doesn't exist or the link may have expired.
            </p>
            <Button variant="outline" onClick={() => window.location.href = "/"}>
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const folder = folderData.folder;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Folder className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">{folder.name}</h1>
          <span className="text-sm text-muted-foreground">
            ({images.length} image{images.length !== 1 ? 's' : ''})
          </span>
        </div>

        {images.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">This folder is empty.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {images.map((image) => (
              <SharedImageCard
                key={image.key}
                image={image}
                copiedUrl={copiedUrl}
                onCopyUrl={copyToClipboard}
                formatFileSize={formatFileSize}
                getFileName={getFileName}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
