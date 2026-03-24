import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, ImageIcon, Download, ArrowRight, TrendingUp, TrendingDown, Minus, Loader2, X, Copy, Check, Save, ExternalLink, FolderOpen } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import StructuredFilenameDialog from "./structured-filename-dialog";
import MtpImagePicker from "@/components/mtp-image-picker";

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

type OutputFormat = "webp" | "png" | "jpeg" | "gif";
type CropMode = "crop" | "stretch";

export default function ImageEditor() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [originalImage, setOriginalImage] = useState<ImageInfo | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [targetWidth, setTargetWidth] = useState<string>("");
  const [targetHeight, setTargetHeight] = useState<string>("");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("webp");
  const [cropMode, setCropMode] = useState<CropMode>("crop");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ProcessedResult | null>(null);

  const [saveDialog, setSaveDialog] = useState<{ type: 'mtp' | 'library'; open: boolean } | null>(null);
  const [saveFilename, setSaveFilename] = useState("");
  const [mtpUploadedLink, setMtpUploadedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [mtpStructuredDialog, setMtpStructuredDialog] = useState(false);
  
  const [downloadDialog, setDownloadDialog] = useState(false);
  const [downloadFilename, setDownloadFilename] = useState("");
  const [mtpPickerOpen, setMtpPickerOpen] = useState(false);

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

  const estimateOutputSize = (): { size: number; status: 'good' | 'warning' | 'danger'; message: string } | null => {
    if (!originalImage) return null;
    
    let width = parseInt(targetWidth) || 0;
    let height = parseInt(targetHeight) || 0;
    
    if (width <= 0 && height <= 0) {
      width = originalImage.width;
      height = originalImage.height;
    } else if (width <= 0) {
      const ratio = originalImage.width / originalImage.height;
      width = Math.round(height * ratio);
    } else if (height <= 0) {
      const ratio = originalImage.height / originalImage.width;
      height = Math.round(width * ratio);
    }
    
    const originalPixels = originalImage.width * originalImage.height;
    const targetPixels = width * height;
    const pixelRatio = targetPixels / originalPixels;
    
    const formatFactors: Record<OutputFormat, number> = {
      'webp': 0.6,
      'jpeg': 0.7,
      'png': 1.2,
      'gif': 1.0,
    };
    
    const formatFactor = formatFactors[outputFormat];
    const estimatedSize = Math.round(originalImage.size * pixelRatio * formatFactor);
    
    const isGif = outputFormat === 'gif' || originalImage.format === 'GIF';
    const threshold = isGif ? 10 * 1024 * 1024 : 500 * 1024;
    const warningThreshold = threshold * 0.8;
    
    let status: 'good' | 'warning' | 'danger';
    let message: string;
    
    if (estimatedSize <= warningThreshold) {
      status = 'good';
      message = isGif ? 'Within optimal GIF size (< 10 MB)' : 'Within optimal image size (< 500 KB)';
    } else if (estimatedSize <= threshold) {
      status = 'warning';
      message = isGif ? 'Approaching 10 MB limit' : 'Approaching 500 KB limit';
    } else {
      status = 'danger';
      message = isGif ? 'Exceeds recommended 10 MB - consider reducing dimensions' : 'Exceeds recommended 500 KB - consider reducing dimensions or using WebP';
    }
    
    return { size: estimatedSize, status, message };
  };

  const isValidFilename = (name: string) => {
    return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0;
  };

  const handleFileSelect = useCallback(async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const format = file.type.split("/")[1] || "unknown";
        const upperFormat = format.toUpperCase();
        setOriginalImage({
          width: img.width,
          height: img.height,
          size: file.size,
          format: upperFormat,
          dataUrl,
        });
        setOriginalFile(file);
        setTargetWidth("");
        setTargetHeight("");
        setResult(null);
        // Set default output format based on input format
        if (upperFormat === 'GIF') {
          setOutputFormat('gif');
        } else {
          setOutputFormat('webp');
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleMtpImageSelect = async (image: { key: string; url: string; size: number }) => {
    try {
      const proxyUrl = `/api/mtp-images/proxy/${encodeURIComponent(image.key)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch image');
      
      const blob = await response.blob();
      const fileName = image.key.split('/').pop() || 'image';
      const file = new File([blob], fileName, { type: blob.type });
      
      handleFileSelect(file);
      setMtpPickerOpen(false);
      
      toast({
        title: "Image loaded",
        description: `Loaded "${fileName}" from MTP library`,
      });
    } catch (error) {
      console.error('Error loading MTP image:', error);
      toast({
        title: "Error",
        description: "Failed to load image from MTP library",
        variant: "destructive",
      });
    }
  };

  const handleWidthChange = (value: string) => {
    setTargetWidth(value);
  };

  const handleHeightChange = (value: string) => {
    setTargetHeight(value);
  };

  const processImage = async () => {
    if (!originalImage || !canvasRef.current) return;

    let width = parseInt(targetWidth) || 0;
    let height = parseInt(targetHeight) || 0;

    if (width <= 0 && height <= 0) {
      width = originalImage.width;
      height = originalImage.height;
    } else if (width <= 0) {
      const ratio = originalImage.width / originalImage.height;
      width = Math.round(height * ratio);
    } else if (height <= 0) {
      const ratio = originalImage.height / originalImage.width;
      height = Math.round(width * ratio);
    }

    if (width > 10000 || height > 10000) {
      toast({
        title: "Dimensions too large",
        description: "Maximum dimension is 10,000 pixels.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setResult(null);

    try {
      const isGif = originalImage.format.toUpperCase() === 'GIF';

      if (isGif && originalFile) {
        setProgress(20);
        const formData = new FormData();
        formData.append('gifFile', originalFile);
        formData.append('width', width.toString());
        formData.append('height', height.toString());
        formData.append('cropMode', cropMode);
        formData.append('outputFormat', outputFormat);

        setProgress(40);
        const response = await fetch('/api/images/resize-gif', {
          method: 'POST',
          body: formData,
        });

        setProgress(70);
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to resize GIF');
        }

        setProgress(100);
        await new Promise(r => setTimeout(r, 200));

        const resultFormat = data.result.format;
        setResult({
          original: originalImage,
          processed: {
            width: data.result.width,
            height: data.result.height,
            size: data.result.size,
            format: resultFormat,
            dataUrl: data.result.dataUrl,
          },
        });

        const formatDesc = resultFormat === 'WEBP' ? 'animated WebP' : 'GIF with animation preserved';
        toast({
          title: `${resultFormat} processed!`,
          description: `Converted to ${data.result.width}x${data.result.height} ${formatDesc}`,
        });
      } else {
        setProgress(10);
        await new Promise(r => setTimeout(r, 100));

        const img = new Image();
        img.crossOrigin = "anonymous";
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = originalImage.dataUrl;
        });

        setProgress(30);
        await new Promise(r => setTimeout(r, 100));

        const canvas = canvasRef.current;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        
        if (!ctx) throw new Error("Could not get canvas context");

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const targetRatio = width / height;
        const sourceRatio = originalImage.width / originalImage.height;

        if (cropMode === "stretch" || Math.abs(targetRatio - sourceRatio) < 0.01) {
          ctx.drawImage(img, 0, 0, width, height);
        } else {
          let sx = 0, sy = 0, sw = originalImage.width, sh = originalImage.height;
          
          if (sourceRatio > targetRatio) {
            sw = originalImage.height * targetRatio;
            sx = (originalImage.width - sw) / 2;
          } else {
            sh = originalImage.width / targetRatio;
            sy = (originalImage.height - sh) / 2;
          }
          
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
        }

        setProgress(60);
        await new Promise(r => setTimeout(r, 100));

        const mimeType = `image/${outputFormat}`;
        const qualityValue = outputFormat === "png" ? undefined : 1.0;
        const processedDataUrl = canvas.toDataURL(mimeType, qualityValue);

        setProgress(80);
        await new Promise(r => setTimeout(r, 100));

        const base64Length = processedDataUrl.length - processedDataUrl.indexOf(",") - 1;
        const processedSize = Math.ceil((base64Length * 3) / 4);

        setProgress(100);
        await new Promise(r => setTimeout(r, 200));

        setResult({
          original: originalImage,
          processed: {
            width,
            height,
            size: processedSize,
            format: outputFormat.toUpperCase(),
            dataUrl: processedDataUrl,
          },
        });

        toast({
          title: "Image processed!",
          description: `Converted to ${width}x${height} ${outputFormat.toUpperCase()}`,
        });
      }
    } catch (error) {
      toast({
        title: "Processing failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const openDownloadDialog = () => {
    if (!result) return;
    setDownloadFilename("");
    setDownloadDialog(true);
  };

  const handleDownload = () => {
    if (!result || !downloadFilename.trim()) return;
    const link = document.createElement("a");
    link.href = result.processed.dataUrl;
    const ext = result.processed.format.toLowerCase();
    link.download = `${downloadFilename.trim()}.${ext}`;
    link.click();
    setDownloadDialog(false);
    setDownloadFilename("");
  };

  const clearAll = () => {
    setOriginalImage(null);
    setOriginalFile(null);
    setResult(null);
    setTargetWidth("");
    setTargetHeight("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isGifFormat = originalImage?.format.toUpperCase() === 'GIF';

  const mtpUploadMutation = useMutation({
    mutationFn: async ({ dataUrl, filename, format, useStructuredNaming = true, folderId }: { dataUrl: string; filename: string; format: string; useStructuredNaming?: boolean; folderId?: number }) => {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const extension = format.toLowerCase();
      const file = new File([blob], `${filename}.${extension}`, { type: `image/${extension}` });
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('filename', `${filename}.${extension}`);
      formData.append('useStructuredNaming', String(useStructuredNaming));
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
    },
    onSuccess: (data) => {
      setMtpUploadedLink(data.url);
      setLinkCopied(false);
      queryClient.invalidateQueries({ queryKey: ['/api/mtp-images'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const librarySaveMutation = useMutation({
    mutationFn: async ({ dataUrl, filename, format }: { dataUrl: string; filename: string; format: string }) => {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const extension = format.toLowerCase();
      const file = new File([blob], `${filename}.${extension}`, { type: `image/${extension}` });
      
      const formData = new FormData();
      formData.append('image', file);
      formData.append('prompt', `Edited image: ${filename}`);
      formData.append('provider', 'image-editor');
      formData.append('status', 'saved');

      const uploadResponse = await fetch('/api/saved-images/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || 'Save failed');
      }
      
      return uploadResponse.json();
    },
    onSuccess: () => {
      toast({
        title: "Saved to library!",
        description: "Image has been added to your Image Library.",
      });
      setSaveDialog(null);
      setSaveFilename("");
      queryClient.invalidateQueries({ queryKey: ['/api/saved-images'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openSaveDialog = (type: 'mtp' | 'library') => {
    setSaveFilename("");
    setMtpUploadedLink(null);
    setLinkCopied(false);
    if (type === 'mtp') {
      setMtpStructuredDialog(true);
    } else {
      setSaveDialog({ type, open: true });
    }
  };
  
  const handleMtpStructuredSave = (filename: string, folderId?: number) => {
    if (!result) return;
    const format = result.processed.format;
    mtpUploadMutation.mutate({ dataUrl: result.processed.dataUrl, filename, format, useStructuredNaming: true, folderId });
    setMtpStructuredDialog(false);
    setSaveDialog({ type: 'mtp', open: true });
  };

  const handleSave = () => {
    if (!result || !isValidFilename(saveFilename)) return;
    
    const format = result.processed.format;
    if (saveDialog?.type === 'mtp') {
      mtpUploadMutation.mutate({ dataUrl: result.processed.dataUrl, filename: saveFilename, format });
    } else {
      librarySaveMutation.mutate({ dataUrl: result.processed.dataUrl, filename: saveFilename, format });
    }
  };

  const copyLink = async () => {
    if (mtpUploadedLink) {
      await navigator.clipboard.writeText(mtpUploadedLink);
      setLinkCopied(true);
      toast({
        title: "Link copied!",
        description: "The link has been copied to your clipboard.",
      });
    }
  };

  const sizeChange = result ? getFileSizeChange(result.original.size, result.processed.size) : null;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <canvas ref={canvasRef} className="hidden" />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Source Image
            </CardTitle>
            <CardDescription>
              Upload an image to resize or convert
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!originalImage ? (
              <>
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover-elevate transition-colors"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-image"
                >
                  <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">
                    Drag & drop an image or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Supports PNG, JPEG, WebP, GIF
                  </p>
                </div>
                <div className="text-center">
                  <span className="text-sm text-muted-foreground">or</span>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setMtpPickerOpen(true)}
                  data-testid="button-import-mtp"
                >
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Import from MTP Library
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                  <img
                    src={originalImage.dataUrl}
                    alt="Original"
                    className="w-full h-full object-contain"
                    data-testid="img-original"
                  />
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute top-2 right-2"
                    onClick={clearAll}
                    data-testid="button-clear-image"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Dimensions:</span>
                    <p className="font-medium" data-testid="text-original-dimensions">
                      {originalImage.width} × {originalImage.height}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Format:</span>
                    <p className="font-medium" data-testid="text-original-format">
                      {originalImage.format}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Size:</span>
                    <p className="font-medium" data-testid="text-original-size">
                      {formatBytes(originalImage.size)}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              data-testid="input-file"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Adjustment Settings</CardTitle>
            <CardDescription>
              Configure size and format options
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <Label className="text-sm font-medium">Dimensions (leave empty to keep original)</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="width" className="text-xs text-muted-foreground">Width (px)</Label>
                  <Input
                    id="width"
                    type="number"
                    value={targetWidth}
                    onChange={(e) => handleWidthChange(e.target.value)}
                    placeholder="Auto"
                    disabled={!originalImage}
                    data-testid="input-width"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="height" className="text-xs text-muted-foreground">Height (px)</Label>
                  <Input
                    id="height"
                    type="number"
                    value={targetHeight}
                    onChange={(e) => handleHeightChange(e.target.value)}
                    placeholder="Auto"
                    disabled={!originalImage}
                    data-testid="input-height"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>If aspect ratio does not match</Label>
              <Select value={cropMode} onValueChange={(v) => setCropMode(v as CropMode)}>
                <SelectTrigger data-testid="select-crop-mode">
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
              {isGifFormat ? (
                <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as OutputFormat)}>
                  <SelectTrigger data-testid="select-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gif">GIF (animation preserved)</SelectItem>
                    <SelectItem value="webp">WebP (animated, smaller file)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as OutputFormat)}>
                  <SelectTrigger data-testid="select-format">
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

            {/* File Size Optimization Guide */}
            <div className="p-3 bg-muted/50 rounded-lg border border-border/50 space-y-1">
              <p className="text-xs font-medium text-foreground">Optimal File Sizes for Web:</p>
              <p className="text-xs text-muted-foreground">• GIFs: &lt; 10 MB for smooth loading</p>
              <p className="text-xs text-muted-foreground">• Images: &lt; 500 KB for fast performance</p>
            </div>

            {/* Estimated Output Size */}
            {originalImage && (() => {
              const estimate = estimateOutputSize();
              if (!estimate) return null;
              
              const statusColors = {
                good: 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400',
                warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400',
                danger: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400',
              };
              
              const statusIcons = {
                good: <TrendingDown className="h-4 w-4" />,
                warning: <Minus className="h-4 w-4" />,
                danger: <TrendingUp className="h-4 w-4" />,
              };
              
              return (
                <div className={`p-3 rounded-lg border ${statusColors[estimate.status]}`} data-testid="estimate-output-size">
                  <div className="flex items-center gap-2 mb-1">
                    {statusIcons[estimate.status]}
                    <span className="text-sm font-medium">Estimated Output: {formatBytes(estimate.size)}</span>
                  </div>
                  <p className="text-xs opacity-80">{estimate.message}</p>
                </div>
              );
            })()}

            {isProcessing && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Processing...</span>
                </div>
                <Progress value={progress} className="h-2" data-testid="progress-bar" />
              </div>
            )}

            <Button
              className="w-full"
              onClick={processImage}
              disabled={!originalImage || isProcessing}
              data-testid="button-process"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Adjust Image
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {result && (
        <Card data-testid="card-result">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>Result</span>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={openDownloadDialog} data-testid="button-download">
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button variant="outline" onClick={() => openSaveDialog('library')} data-testid="button-save-library">
                  <Save className="h-4 w-4 mr-2" />
                  Add to Image Library
                </Button>
                <Button onClick={() => openSaveDialog('mtp')} data-testid="button-mtp-upload">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Add to MTP-Images & Create Link
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                <img
                  src={result.processed.dataUrl}
                  alt="Processed"
                  className="w-full h-full object-contain"
                  data-testid="img-result"
                />
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Original</span>
                    <p className="text-sm" data-testid="text-compare-original">
                      {result.original.width} × {result.original.height}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">New</span>
                    <p className="text-sm font-medium" data-testid="text-compare-new">
                      {result.processed.width} × {result.processed.height}
                    </p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Format</span>
                    <span className="font-medium" data-testid="text-result-format">
                      {result.original.format} <ArrowRight className="h-3 w-3 inline mx-1" /> {result.processed.format}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">File Size</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium" data-testid="text-result-size">
                        {formatBytes(result.processed.size)}
                      </span>
                      {sizeChange && sizeChange.direction !== "same" && (
                        <span 
                          className={`flex items-center gap-1 text-sm ${
                            sizeChange.direction === "down" ? "text-green-500" : "text-red-500"
                          }`}
                          data-testid="text-size-change"
                        >
                          {sizeChange.direction === "down" ? (
                            <TrendingDown className="h-4 w-4" />
                          ) : (
                            <TrendingUp className="h-4 w-4" />
                          )}
                          {sizeChange.percent.toFixed(0)}% {sizeChange.direction === "down" ? "smaller" : "larger"}
                        </span>
                      )}
                      {sizeChange && sizeChange.direction === "same" && (
                        <span className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="text-size-change">
                          <Minus className="h-4 w-4" />
                          Same size
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Original size:</span>
                    <span>{formatBytes(result.original.size)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">New size:</span>
                    <span className="font-medium">{formatBytes(result.processed.size)}</span>
                  </div>
                  {sizeChange && sizeChange.direction === "down" && (
                    <div className="mt-2 text-sm text-green-500" data-testid="text-savings">
                      Saved {formatBytes(result.original.size - result.processed.size)}!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={downloadDialog} onOpenChange={setDownloadDialog}>
        <DialogContent data-testid="dialog-download">
          <DialogHeader>
            <DialogTitle>Download Image</DialogTitle>
            <DialogDescription>
              Enter a name for your file. The extension (.{result?.processed.format.toLowerCase() || 'webp'}) will be added automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="download-filename">File Name</Label>
            <Input
              id="download-filename"
              value={downloadFilename}
              onChange={(e) => setDownloadFilename(e.target.value)}
              placeholder="my-image"
              data-testid="input-download-filename"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && downloadFilename.trim()) {
                  handleDownload();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDownloadDialog(false)}
              data-testid="button-download-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDownload}
              disabled={!downloadFilename.trim()}
              data-testid="button-download-confirm"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog 
        open={saveDialog?.open || false} 
        onOpenChange={(open) => {
          if (!open) {
            setSaveDialog(null);
            setMtpUploadedLink(null);
          }
        }}
      >
        <DialogContent data-testid="dialog-save">
          <DialogHeader>
            <DialogTitle>
              {mtpUploadedLink 
                ? "Upload Complete!" 
                : saveDialog?.type === 'mtp' 
                  ? "Add to MTP-Images & Create Link" 
                  : "Add to Image Library"
              }
            </DialogTitle>
            <DialogDescription>
              {mtpUploadedLink 
                ? "Your file has been uploaded successfully. Copy the link below."
                : "Enter a name for your file. Only letters, numbers, underscores, and hyphens are allowed (no spaces or special characters)."
              }
            </DialogDescription>
          </DialogHeader>
          
          {mtpUploadedLink ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  value={mtpUploadedLink}
                  readOnly
                  className="flex-1 font-mono text-sm"
                  data-testid="input-mtp-link"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyLink}
                  data-testid="button-copy-link"
                >
                  {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setSaveDialog(null)} data-testid="button-done">
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="filename">File Name</Label>
                <Input
                  id="filename"
                  value={saveFilename}
                  onChange={(e) => setSaveFilename(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  placeholder="my-image-name"
                  data-testid="input-save-filename"
                />
                {saveFilename && !isValidFilename(saveFilename) && (
                  <p className="text-sm text-destructive">
                    Only letters, numbers, underscores, and hyphens allowed.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSaveDialog(null)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!isValidFilename(saveFilename) || mtpUploadMutation.isPending || librarySaveMutation.isPending}
                  data-testid="button-save"
                >
                  {(mtpUploadMutation.isPending || librarySaveMutation.isPending) ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <StructuredFilenameDialog
        open={mtpStructuredDialog}
        onOpenChange={setMtpStructuredDialog}
        onSave={handleMtpStructuredSave}
        isPending={mtpUploadMutation.isPending}
        title="Add to MTP-Images & Create Link"
        description="Use the structured naming convention for your file."
      />

      <MtpImagePicker
        open={mtpPickerOpen}
        onOpenChange={setMtpPickerOpen}
        onSelect={handleMtpImageSelect}
        title="Select Image from MTP Library"
        description="Browse your MTP library to select an image for editing"
        fileType="images"
      />
    </div>
  );
}
