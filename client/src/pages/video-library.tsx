import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2, Video as VideoIcon, Download, ChevronLeft, ChevronRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Product, SavedVideo } from "@shared/schema";

const PAGE_SIZE = 12;

interface PaginatedVideosResponse {
  success: boolean;
  videos: SavedVideo[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

export default function VideoLibrary() {
  const { toast } = useToast();
  const [filterProductId, setFilterProductId] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [videoToDelete, setVideoToDelete] = useState<SavedVideo | null>(null);
  
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadFilename, setDownloadFilename] = useState("");
  const [pendingDownload, setPendingDownload] = useState<SavedVideo | null>(null);

  const queryParams = new URLSearchParams({
    page: String(currentPage),
    limit: String(PAGE_SIZE),
  });
  if (filterProductId !== "all") {
    queryParams.set("productId", filterProductId);
  }

  const { data: videosData, isLoading: videosLoading } = useQuery<PaginatedVideosResponse>({
    queryKey: ["/api/videos", currentPage, filterProductId],
    queryFn: async () => {
      const res = await fetch(`/api/videos?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch videos");
      return res.json();
    },
  });

  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });
  const products = productsData?.products || [];

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/videos/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Video Deleted",
        description: "The video has been removed from your library.",
      });
      setVideoToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (video: SavedVideo) => {
    setVideoToDelete(video);
  };

  const handleConfirmDelete = () => {
    if (videoToDelete) {
      deleteMutation.mutate(videoToDelete.id);
    }
  };

  const openDownloadDialog = (video: SavedVideo) => {
    setPendingDownload(video);
    setDownloadFilename("");
    setDownloadDialogOpen(true);
  };

  const handleDownload = async () => {
    if (!pendingDownload || !downloadFilename.trim()) return;
    
    try {
      const response = await fetch(pendingDownload.url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${downloadFilename.trim()}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setDownloadDialogOpen(false);
      setPendingDownload(null);
      setDownloadFilename("");
      
      toast({
        title: "Download Started",
        description: "Your video is being downloaded.",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Failed to download video",
        variant: "destructive",
      });
    }
  };

  const handleFilterChange = (value: string) => {
    setFilterProductId(value);
    setCurrentPage(1);
  };

  const videos = videosData?.videos || [];
  const total = videosData?.total || 0;
  const totalPages = videosData?.totalPages || 1;

  const getProductName = (productId: string | null) => {
    if (!productId) return "No product association";
    const product = products.find(p => p.id === productId);
    return product ? product.name : "Unknown Product";
  };

  const getGenerationTypeDisplay = (type: string) => {
    switch (type) {
      case 'text-to-video':
        return 'Text to Video';
      case 'image-to-video':
        return 'Image to Video';
      case 'reference-to-video':
        return 'Reference to Video';
      default:
        return type;
    }
  };

  const getProviderDisplay = (provider: string) => {
    switch (provider) {
      case 'sora':
        return 'Sora 2';
      case 'veo':
        return 'Veo 3.1';
      default:
        return provider;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Video Library</h1>
        <Badge variant="outline" data-testid="badge-video-count">
          {total} {total === 1 ? 'video' : 'videos'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter Videos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center flex-wrap">
            <Select value={filterProductId} onValueChange={handleFilterChange}>
              <SelectTrigger className="w-64" data-testid="select-filter-product">
                <SelectValue placeholder="Filter by product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-filter-all">
                  All Videos
                </SelectItem>
                <SelectItem value="none" data-testid="option-filter-none">
                  No Product Association
                </SelectItem>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id} data-testid={`option-filter-${product.id}`}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {videosLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : videos.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-2">
              <VideoIcon className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">No videos found</p>
              <p className="text-sm text-muted-foreground">
                {filterProductId === "all" 
                  ? "Generate and save videos to see them here."
                  : "No videos found for the selected filter."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {videos.map((video) => (
              <Card key={video.id} data-testid={`video-card-${video.id}`}>
                <CardContent className="p-4 space-y-3">
                  <video
                    src={video.url}
                    controls
                    className="w-full rounded-lg border"
                    data-testid={`video-player-${video.id}`}
                  />
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant="secondary" data-testid={`badge-provider-${video.id}`}>
                        {getProviderDisplay(video.provider)}
                      </Badge>
                      <Badge variant="outline" data-testid={`badge-duration-${video.id}`}>
                        {video.duration}s
                      </Badge>
                    </div>

                    <div className="text-sm">
                      <p className="font-medium text-muted-foreground">
                        {getGenerationTypeDisplay(video.generationType)}
                      </p>
                    </div>

                    {video.aspectRatio && (
                      <div className="text-xs text-muted-foreground">
                        Aspect Ratio: {video.aspectRatio}
                      </div>
                    )}

                    <div className="text-sm">
                      <p className="font-medium">Product:</p>
                      <p className="text-muted-foreground">{getProductName(video.productId)}</p>
                    </div>

                    <div className="text-sm">
                      <p className="font-medium">Prompt:</p>
                      <p className="text-muted-foreground line-clamp-2" title={video.prompt}>
                        {video.prompt}
                      </p>
                    </div>

                    {video.referenceImageUrls && video.referenceImageUrls.length > 0 && (
                      <div className="text-sm">
                        <p className="font-medium mb-1">Reference Images:</p>
                        <div className="grid grid-cols-3 gap-1">
                          {video.referenceImageUrls.map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt={`Reference ${idx + 1}`}
                              className="w-full h-16 object-cover rounded border"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      {new Date(video.createdAt).toLocaleDateString()}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={() => openDownloadDialog(video)}
                        data-testid={`button-download-${video.id}`}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Save to Computer
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteClick(video)}
                        disabled={deleteMutation.isPending && videoToDelete?.id === video.id}
                        data-testid={`button-delete-${video.id}`}
                      >
                        {deleteMutation.isPending && videoToDelete?.id === video.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                data-testid="button-next-page"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen}>
        <DialogContent data-testid="dialog-download">
          <DialogHeader>
            <DialogTitle>Download Video</DialogTitle>
            <DialogDescription>
              Enter a name for your file. The extension (.mp4) will be added automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="download-filename">File Name</Label>
            <Input
              id="download-filename"
              value={downloadFilename}
              onChange={(e) => setDownloadFilename(e.target.value)}
              placeholder="my-video"
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
              onClick={() => setDownloadDialogOpen(false)}
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

      <AlertDialog open={!!videoToDelete} onOpenChange={(open) => !open && setVideoToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this video from your library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
