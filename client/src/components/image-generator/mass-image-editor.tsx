import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, ImageIcon, Download, ArrowRight, TrendingUp, TrendingDown, Minus, Loader2, X, Copy, Check, Save, ExternalLink, FolderOpen, Images, Percent, RectangleHorizontal } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import StructuredFilenameDialog from "./structured-filename-dialog";

interface ImageInfo {
  width: number;
  height: number;
  size: number;
  format: string;
  dataUrl: string;
}

interface ProcessedResult {
  original: ImageInfo;
  processed: ImageInfo;
}

interface UploadedImage {
  id: string;
  file: File;
  info: ImageInfo;
  result: ProcessedResult | null;
  mtpLink: string | null;
  linkCopied: boolean;
}

type OutputFormat = "webp" | "png" | "jpeg" | "gif";
type CropMode = "crop" | "stretch";
type SizeMode = "percentage" | "aspect-ratio";

interface AspectRatioPreset {
  label: string;
  ratio: number;
  w: number;
  h: number;
}

const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { label: "Square (1:1)", ratio: 1, w: 1, h: 1 },
  { label: "Landscape (16:9)", ratio: 16 / 9, w: 16, h: 9 },
  { label: "Portrait (9:16)", ratio: 9 / 16, w: 9, h: 16 },
  { label: "Standard (4:3)", ratio: 4 / 3, w: 4, h: 3 },
  { label: "Standard Portrait (3:4)", ratio: 3 / 4, w: 3, h: 4 },
  { label: "Photo (3:2)", ratio: 3 / 2, w: 3, h: 2 },
  { label: "Photo Portrait (2:3)", ratio: 2 / 3, w: 2, h: 3 },
  { label: "Social (4:5)", ratio: 4 / 5, w: 4, h: 5 },
  { label: "Ultrawide (21:9)", ratio: 21 / 9, w: 21, h: 9 },
];

export default function MassImageEditor() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [sizeMode, setSizeMode] = useState<SizeMode>("percentage");
  const [percentage, setPercentage] = useState<string>("100");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>("0");
  const [aspectWidth, setAspectWidth] = useState<string>("");
  const [aspectHeight, setAspectHeight] = useState<string>("");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("webp");
  const [cropMode, setCropMode] = useState<CropMode>("crop");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentProcessing, setCurrentProcessing] = useState(0);

  const [downloadDialog, setDownloadDialog] = useState(false);
  const [downloadFilename, setDownloadFilename] = useState("");
  const [downloadImageId, setDownloadImageId] = useState<string | null>(null);

  const [mtpStructuredDialog, setMtpStructuredDialog] = useState(false);
  const [mtpSaveMode, setMtpSaveMode] = useState<"single" | "bulk">("single");
  const [mtpSingleImageId, setMtpSingleImageId] = useState<string | null>(null);

  const [bulkMtpProgress, setBulkMtpProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkMtpResults, setBulkMtpResults] = useState<Array<{ id: string; url: string; filename: string }>>([]);
  const [bulkMtpResultsDialog, setBulkMtpResultsDialog] = useState(false);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getFileSizeChange = (original: number, processed: number): { percent: number; direction: "up" | "down" | "same" } => {
    const change = ((processed - original) / original) * 100;
    if (Math.abs(change) < 1) return { percent: 0, direction: "same" };
    return { percent: Math.abs(change), direction: change > 0 ? "up" : "down" };
  };

  const handleFilesSelect = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (fileArray.length === 0) return;

    const newImages: UploadedImage[] = [];

    for (const file of fileArray) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const info = await new Promise<ImageInfo>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const format = file.type.split("/")[1] || "unknown";
          resolve({
            width: img.width,
            height: img.height,
            size: file.size,
            format: format.toUpperCase(),
            dataUrl,
          });
        };
        img.src = dataUrl;
      });

      newImages.push({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        info,
        result: null,
        mtpLink: null,
        linkCopied: false,
      });
    }

    setImages(prev => [...prev, ...newImages]);
    toast({
      title: `${newImages.length} image${newImages.length > 1 ? "s" : ""} added`,
      description: `Ready for batch processing`,
    });
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      handleFilesSelect(e.dataTransfer.files);
    }
  }, [handleFilesSelect]);

  const removeImage = (id: string) => {
    setImages(prev => {
      const updated = prev.filter(img => img.id !== id);
      const stillHasGif = updated.some(img => img.info.format.toUpperCase() === 'GIF');
      if (!stillHasGif && (outputFormat === 'gif')) {
        setOutputFormat('webp');
      }
      return updated;
    });
  };

  const clearAll = () => {
    setImages([]);
  };

  const handleAspectRatioChange = (value: string) => {
    setSelectedAspectRatio(value);
    const preset = ASPECT_RATIO_PRESETS[parseInt(value)];
    if (preset) {
      setAspectWidth("");
      setAspectHeight("");
    }
  };

  const handleAspectWidthChange = (value: string) => {
    setAspectWidth(value);
    const w = parseInt(value);
    if (w > 0 && selectedAspectRatio) {
      const preset = ASPECT_RATIO_PRESETS[parseInt(selectedAspectRatio)];
      if (preset) {
        setAspectHeight(String(Math.round(w / preset.ratio)));
      }
    }
  };

  const handleAspectHeightChange = (value: string) => {
    setAspectHeight(value);
    const h = parseInt(value);
    if (h > 0 && selectedAspectRatio) {
      const preset = ASPECT_RATIO_PRESETS[parseInt(selectedAspectRatio)];
      if (preset) {
        setAspectWidth(String(Math.round(h * preset.ratio)));
      }
    }
  };

  const getTargetDimensions = (originalWidth: number, originalHeight: number): { width: number; height: number } => {
    if (sizeMode === "percentage") {
      const pct = parseInt(percentage) || 100;
      return {
        width: Math.round(originalWidth * (pct / 100)),
        height: Math.round(originalHeight * (pct / 100)),
      };
    } else {
      const preset = ASPECT_RATIO_PRESETS[parseInt(selectedAspectRatio)];
      if (!preset) return { width: originalWidth, height: originalHeight };

      const w = parseInt(aspectWidth);
      const h = parseInt(aspectHeight);

      if (w > 0 && h > 0) {
        return { width: w, height: h };
      }

      if (w > 0) {
        return { width: w, height: Math.round(w / preset.ratio) };
      }

      if (h > 0) {
        return { width: Math.round(h * preset.ratio), height: h };
      }

      return {
        width: originalWidth,
        height: Math.round(originalWidth / preset.ratio),
      };
    }
  };

  const processAllImages = async () => {
    if (images.length === 0 || !canvasRef.current) return;

    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessing(0);

    const updatedImages = [...images];

    for (let i = 0; i < updatedImages.length; i++) {
      setCurrentProcessing(i + 1);
      setProgress(Math.round(((i) / updatedImages.length) * 100));
      const img = updatedImages[i];
      const { width, height } = getTargetDimensions(img.info.width, img.info.height);

      if (width > 10000 || height > 10000) {
        toast({
          title: `Skipped ${img.file.name}`,
          description: "Max dimension is 10,000px",
          variant: "destructive",
        });
        continue;
      }

      try {
        const isGif = img.info.format.toUpperCase() === 'GIF';

        if (isGif) {
          const formData = new FormData();
          formData.append('gifFile', img.file);
          formData.append('width', width.toString());
          formData.append('height', height.toString());
          formData.append('cropMode', cropMode);
          formData.append('outputFormat', outputFormat);

          const response = await fetch('/api/images/resize-gif', {
            method: 'POST',
            body: formData,
          });

          const data = await response.json();
          if (!data.success) throw new Error(data.error || 'Failed to resize GIF');

          updatedImages[i] = {
            ...img,
            result: {
              original: img.info,
              processed: {
                width: data.result.width,
                height: data.result.height,
                size: data.result.size,
                format: data.result.format,
                dataUrl: data.result.dataUrl,
              },
            },
          };
        } else {
          const srcImg = new Image();
          srcImg.crossOrigin = "anonymous";
          await new Promise<void>((resolve, reject) => {
            srcImg.onload = () => resolve();
            srcImg.onerror = reject;
            srcImg.src = img.info.dataUrl;
          });

          const canvas = canvasRef.current!;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Could not get canvas context");

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";

          const targetRatio = width / height;
          const sourceRatio = img.info.width / img.info.height;

          if (cropMode === "stretch" || Math.abs(targetRatio - sourceRatio) < 0.01) {
            ctx.drawImage(srcImg, 0, 0, width, height);
          } else {
            let sx = 0, sy = 0, sw = img.info.width, sh = img.info.height;
            if (sourceRatio > targetRatio) {
              sw = img.info.height * targetRatio;
              sx = (img.info.width - sw) / 2;
            } else {
              sh = img.info.width / targetRatio;
              sy = (img.info.height - sh) / 2;
            }
            ctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, width, height);
          }

          const mimeType = `image/${outputFormat}`;
          const qualityValue = outputFormat === "png" ? undefined : 1.0;
          const processedDataUrl = canvas.toDataURL(mimeType, qualityValue);

          const base64Length = processedDataUrl.length - processedDataUrl.indexOf(",") - 1;
          const processedSize = Math.ceil((base64Length * 3) / 4);

          updatedImages[i] = {
            ...img,
            result: {
              original: img.info,
              processed: {
                width,
                height,
                size: processedSize,
                format: outputFormat.toUpperCase(),
                dataUrl: processedDataUrl,
              },
            },
          };
        }
      } catch (error) {
        toast({
          title: `Failed to process ${img.file.name}`,
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      }
    }

    setImages(updatedImages);
    setProgress(100);

    setTimeout(() => {
      setIsProcessing(false);
      setProgress(0);
      setCurrentProcessing(0);
    }, 500);

    const successCount = updatedImages.filter(img => img.result).length;
    toast({
      title: "Batch processing complete!",
      description: `${successCount} of ${updatedImages.length} images processed successfully`,
    });
  };

  const processedImages = images.filter(img => img.result);

  const openDownloadDialog = (imageId: string) => {
    setDownloadImageId(imageId);
    setDownloadFilename("");
    setDownloadDialog(true);
  };

  const handleDownload = () => {
    if (!downloadFilename.trim()) return;
    const img = images.find(i => i.id === downloadImageId);
    if (!img?.result) return;

    const link = document.createElement("a");
    link.href = img.result.processed.dataUrl;
    const ext = img.result.processed.format.toLowerCase();
    link.download = `${downloadFilename.trim()}.${ext}`;
    link.click();
    setDownloadDialog(false);
    setDownloadFilename("");
  };

  const handleDownloadAll = () => {
    const processed = images.filter(i => i.result);
    if (processed.length === 0) return;

    processed.forEach((img, idx) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.href = img.result!.processed.dataUrl;
        const ext = img.result!.processed.format.toLowerCase();
        const baseName = img.file.name.replace(/\.[^.]+$/, "");
        link.download = `${baseName}-edited.${ext}`;
        link.click();
      }, idx * 200);
    });

    toast({
      title: "Downloading all images",
      description: `${processed.length} images are being downloaded`,
    });
  };

  const openMtpSingle = (imageId: string) => {
    setMtpSaveMode("single");
    setMtpSingleImageId(imageId);
    setMtpStructuredDialog(true);
  };

  const openMtpBulk = () => {
    setMtpSaveMode("bulk");
    setMtpSingleImageId(null);
    setMtpStructuredDialog(true);
  };

  const mtpUploadSingle = async (dataUrl: string, filename: string, format: string, folderId?: number) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const extension = format.toLowerCase();
    const file = new File([blob], `${filename}.${extension}`, { type: `image/${extension}` });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', `${filename}.${extension}`);
    formData.append('useStructuredNaming', 'true');
    if (folderId) {
      formData.append('folderId', String(folderId));
    }

    const uploadResponse = await fetch('/api/mtp-images/upload', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json();
      throw new Error(error.error || 'Upload failed');
    }

    return uploadResponse.json();
  };

  const handleMtpStructuredSave = async (filename: string, folderId?: number) => {
    setMtpStructuredDialog(false);

    if (mtpSaveMode === "single" && mtpSingleImageId) {
      const img = images.find(i => i.id === mtpSingleImageId);
      if (!img?.result) return;

      try {
        const data = await mtpUploadSingle(
          img.result.processed.dataUrl,
          filename,
          img.result.processed.format,
          folderId
        );

        setImages(prev => prev.map(i =>
          i.id === mtpSingleImageId
            ? { ...i, mtpLink: data.url, linkCopied: false }
            : i
        ));
        queryClient.invalidateQueries({ queryKey: ['/api/mtp-images'] });

        toast({
          title: "Uploaded to MTP-Images!",
          description: `Link: ${data.url}`,
        });
      } catch (error) {
        toast({
          title: "Upload failed",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      }
    } else if (mtpSaveMode === "bulk") {
      const toUpload = images.filter(i => i.result);
      if (toUpload.length === 0) return;

      setBulkMtpProgress({ current: 0, total: toUpload.length });
      const results: Array<{ id: string; url: string; filename: string }> = [];

      const basePrefix = filename.replace(/-\d{3,}$/, '');

      let seqNum = 1;
      try {
        const seqResponse = await fetch(`/api/mtp-naming/next-sequence?prefix=${encodeURIComponent(basePrefix)}`);
        const seqData = await seqResponse.json();
        if (seqData.success && seqData.nextSequence) {
          seqNum = seqData.nextSequence;
        }
      } catch {
        const startMatch = filename.match(/-(\d{3,})$/);
        seqNum = startMatch ? parseInt(startMatch[1]) : 1;
      }

      for (let i = 0; i < toUpload.length; i++) {
        setBulkMtpProgress({ current: i + 1, total: toUpload.length });
        const img = toUpload[i];
        const paddedSeq = String(seqNum).padStart(3, '0');
        const itemFilename = `${basePrefix}-${paddedSeq}`;

        try {
          const data = await mtpUploadSingle(
            img.result!.processed.dataUrl,
            itemFilename,
            img.result!.processed.format,
            folderId
          );

          results.push({ id: img.id, url: data.url, filename: itemFilename });

          setImages(prev => prev.map(im =>
            im.id === img.id
              ? { ...im, mtpLink: data.url, linkCopied: false }
              : im
          ));
        } catch (error) {
          toast({
            title: `Failed to upload image ${i + 1}`,
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        }

        seqNum++;
      }

      setBulkMtpProgress(null);
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-images'] });

      if (results.length > 0) {
        setBulkMtpResults(results);
        setBulkMtpResultsDialog(true);
        toast({
          title: "Bulk upload complete!",
          description: `${results.length} of ${toUpload.length} images uploaded to MTP-Images`,
        });
      }
    }
  };

  const copyLink = async (imageId: string) => {
    const img = images.find(i => i.id === imageId);
    if (img?.mtpLink) {
      await navigator.clipboard.writeText(img.mtpLink);
      setImages(prev => prev.map(i =>
        i.id === imageId ? { ...i, linkCopied: true } : i
      ));
      toast({ title: "Link copied!" });
    }
  };

  const copyAllLinks = async () => {
    const links = images
      .filter(i => i.mtpLink)
      .map(i => i.mtpLink)
      .join("\n");
    if (links) {
      await navigator.clipboard.writeText(links);
      toast({ title: "All links copied!", description: `${links.split("\n").length} links copied to clipboard` });
    }
  };

  const hasAnyGif = images.some(img => img.info.format.toUpperCase() === 'GIF');

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <canvas ref={canvasRef} className="hidden" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Images className="h-5 w-5" />
              Source Images
            </CardTitle>
            <CardDescription>
              Upload multiple images for batch editing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover-elevate transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-mass-images"
            >
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">
                Drag & drop multiple images or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Supports PNG, JPEG, WebP, GIF
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFilesSelect(e.target.files);
                  e.target.value = "";
                }
              }}
              data-testid="input-mass-files"
            />

            {images.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {images.length} image{images.length > 1 ? "s" : ""} loaded
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-add-more"
                    >
                      Add More
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAll}
                      data-testid="button-clear-all"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Clear All
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
                  {images.map((img) => (
                    <div key={img.id} className="relative group rounded-md overflow-visible border border-border">
                      <div className="aspect-square overflow-hidden rounded-md">
                        <img
                          src={img.info.dataUrl}
                          alt={img.file.name}
                          className="w-full h-full object-cover"
                          data-testid={`img-thumb-${img.id}`}
                        />
                      </div>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                        data-testid={`button-remove-${img.id}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      <div className="p-1 text-[10px] text-muted-foreground truncate">
                        {img.info.width}x{img.info.height} {img.info.format}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Batch Settings</CardTitle>
            <CardDescription>
              Applied to all images
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Sizing Method</Label>
              <div className="flex gap-2">
                <Button
                  variant={sizeMode === "percentage" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSizeMode("percentage")}
                  className="flex-1"
                  data-testid="button-mode-percentage"
                >
                  <Percent className="h-4 w-4 mr-1" />
                  Percentage
                </Button>
                <Button
                  variant={sizeMode === "aspect-ratio" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSizeMode("aspect-ratio")}
                  className="flex-1"
                  data-testid="button-mode-aspect"
                >
                  <RectangleHorizontal className="h-4 w-4 mr-1" />
                  Aspect Ratio
                </Button>
              </div>
            </div>

            {sizeMode === "percentage" ? (
              <div className="space-y-2">
                <Label>Resize Percentage</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                    min="1"
                    max="500"
                    className="w-24"
                    data-testid="input-percentage"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[25, 50, 75, 100, 150, 200].map(pct => (
                    <Button
                      key={pct}
                      variant={percentage === String(pct) ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPercentage(String(pct))}
                      data-testid={`button-pct-${pct}`}
                    >
                      {pct}%
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Aspect Ratio</Label>
                  <Select value={selectedAspectRatio} onValueChange={handleAspectRatioChange}>
                    <SelectTrigger data-testid="select-aspect-ratio">
                      <SelectValue placeholder="Select ratio..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ASPECT_RATIO_PRESETS.map((preset, idx) => (
                        <SelectItem key={idx} value={String(idx)}>{preset.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Width (px)</Label>
                    <Input
                      type="number"
                      value={aspectWidth}
                      onChange={(e) => handleAspectWidthChange(e.target.value)}
                      placeholder="Auto"
                      data-testid="input-aspect-width"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Height (px)</Label>
                    <Input
                      type="number"
                      value={aspectHeight}
                      onChange={(e) => handleAspectHeightChange(e.target.value)}
                      placeholder="Auto"
                      data-testid="input-aspect-height"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Set width or height - the other adjusts automatically to maintain the selected ratio.
                  Leave both empty to use each image's original width.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>If aspect ratio does not match</Label>
              <Select value={cropMode} onValueChange={(v) => setCropMode(v as CropMode)}>
                <SelectTrigger data-testid="select-crop-mode-mass">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="crop">Center and crop to fit</SelectItem>
                  <SelectItem value="stretch">Stretch to fit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Output Format</Label>
              {hasAnyGif ? (
                <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as OutputFormat)}>
                  <SelectTrigger data-testid="select-format-mass">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gif">GIF (animation preserved)</SelectItem>
                    <SelectItem value="webp">WebP (animated, smaller file)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as OutputFormat)}>
                  <SelectTrigger data-testid="select-format-mass">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="webp">WebP (recommended)</SelectItem>
                    <SelectItem value="png">PNG (lossless)</SelectItem>
                    <SelectItem value="jpeg">JPEG</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {isProcessing && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Processing {currentProcessing} of {images.length}...</span>
                </div>
                <Progress value={progress} className="h-2" data-testid="progress-bar-mass" />
              </div>
            )}

            <Button
              className="w-full"
              onClick={processAllImages}
              disabled={images.length === 0 || isProcessing}
              data-testid="button-process-all"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing {currentProcessing}/{images.length}...
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Process All Images ({images.length})
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {processedImages.length > 0 && (
        <Card data-testid="card-bulk-results">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>Results ({processedImages.length} images)</span>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleDownloadAll} data-testid="button-download-all">
                  <Download className="h-4 w-4 mr-2" />
                  Download All
                </Button>
                <Button onClick={openMtpBulk} data-testid="button-mtp-upload-all">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Add All to MTP-Images & Create Links
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bulkMtpProgress && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Uploading {bulkMtpProgress.current} of {bulkMtpProgress.total}...</span>
                </div>
                <Progress value={Math.round((bulkMtpProgress.current / bulkMtpProgress.total) * 100)} className="h-2" />
              </div>
            )}

            <div className="space-y-4">
              {processedImages.map((img) => {
                const sizeChange = getFileSizeChange(img.result!.original.size, img.result!.processed.size);
                return (
                  <div key={img.id} className="border border-border rounded-md p-4" data-testid={`result-card-${img.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <span className="text-sm font-medium truncate max-w-[200px]">{img.file.name}</span>
                      <div className="flex flex-wrap gap-2">
                        {img.mtpLink ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={img.mtpLink}
                              readOnly
                              className="h-8 text-xs font-mono w-48"
                              data-testid={`input-link-${img.id}`}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => copyLink(img.id)}
                              data-testid={`button-copy-${img.id}`}
                            >
                              {img.linkCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Button variant="outline" size="sm" onClick={() => openDownloadDialog(img.id)} data-testid={`button-download-${img.id}`}>
                              <Download className="h-3 w-3 mr-1" />
                              Download
                            </Button>
                            <Button size="sm" onClick={() => openMtpSingle(img.id)} data-testid={`button-mtp-${img.id}`}>
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Add to MTP-Images
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="aspect-video bg-muted rounded-md overflow-hidden">
                          <img
                            src={img.result!.processed.dataUrl}
                            alt="Processed"
                            className="w-full h-full object-contain"
                            data-testid={`img-processed-${img.id}`}
                          />
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-xs text-muted-foreground">Original</span>
                            <p>{img.result!.original.width} x {img.result!.original.height}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(img.result!.original.size)} {img.result!.original.format}</p>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">New</span>
                            <p className="font-medium">{img.result!.processed.width} x {img.result!.processed.height}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(img.result!.processed.size)} {img.result!.processed.format}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-1 border-t border-border">
                          <span className="text-xs text-muted-foreground">Size:</span>
                          {sizeChange.direction === "down" ? (
                            <span className="flex items-center gap-1 text-xs text-green-500">
                              <TrendingDown className="h-3 w-3" />
                              {sizeChange.percent.toFixed(0)}% smaller
                            </span>
                          ) : sizeChange.direction === "up" ? (
                            <span className="flex items-center gap-1 text-xs text-red-500">
                              <TrendingUp className="h-3 w-3" />
                              {sizeChange.percent.toFixed(0)}% larger
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Minus className="h-3 w-3" />
                              Same size
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={downloadDialog} onOpenChange={setDownloadDialog}>
        <DialogContent data-testid="dialog-download-mass">
          <DialogHeader>
            <DialogTitle>Download Image</DialogTitle>
            <DialogDescription>
              Enter a name for your file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="download-filename-mass">File Name</Label>
            <Input
              id="download-filename-mass"
              value={downloadFilename}
              onChange={(e) => setDownloadFilename(e.target.value)}
              placeholder="my-image"
              data-testid="input-download-filename-mass"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && downloadFilename.trim()) handleDownload();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownloadDialog(false)}>Cancel</Button>
            <Button onClick={handleDownload} disabled={!downloadFilename.trim()} data-testid="button-download-confirm-mass">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StructuredFilenameDialog
        open={mtpStructuredDialog}
        onOpenChange={setMtpStructuredDialog}
        onSave={handleMtpStructuredSave}
        isPending={false}
        title={mtpSaveMode === "bulk" ? `Add All to MTP-Images (${processedImages.length} images)` : "Add to MTP-Images & Create Link"}
        description={mtpSaveMode === "bulk"
          ? "Set the naming convention. Sequence numbers will auto-increment for each image."
          : "Use the structured naming convention for your file."
        }
        progress={bulkMtpProgress ? { current: bulkMtpProgress.current, total: bulkMtpProgress.total } : undefined}
      />

      <Dialog open={bulkMtpResultsDialog} onOpenChange={setBulkMtpResultsDialog}>
        <DialogContent className="sm:max-w-[550px]" data-testid="dialog-bulk-results">
          <DialogHeader>
            <DialogTitle>Bulk Upload Complete</DialogTitle>
            <DialogDescription>
              {bulkMtpResults.length} images uploaded to MTP-Images
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {bulkMtpResults.map((result) => (
              <div key={result.id} className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="shrink-0">{result.filename}</Badge>
                <Input value={result.url} readOnly className="flex-1 h-7 text-xs font-mono" />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyAllLinks} data-testid="button-copy-all-links">
              <Copy className="h-4 w-4 mr-2" />
              Copy All Links
            </Button>
            <Button onClick={() => setBulkMtpResultsDialog(false)} data-testid="button-done-bulk">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
