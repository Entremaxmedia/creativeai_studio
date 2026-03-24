import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Loader2, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Product, SavedImage } from "@shared/schema";
import MTPImages from "@/components/mtp-images";

export default function ImageLibrary() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("mtp");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [includeUnsaved, setIncludeUnsaved] = useState(false);
  const [deleteImageId, setDeleteImageId] = useState<string | null>(null);
  const [detailsImage, setDetailsImage] = useState<SavedImage | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 12;

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [productFilter, includeUnsaved]);

  // Fetch products for filter dropdown
  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ['/api/products'],
  });
  const products = productsData?.products || [];

  // Fetch saved images with pagination
  const { data: imagesData, isLoading, error } = useQuery<{ 
    success: boolean; 
    items: SavedImage[];
    total: number;
    totalPages: number;
    currentPage: number;
  }>({
    queryKey: ['/api/saved-images', currentPage, productFilter, includeUnsaved],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: ITEMS_PER_PAGE.toString(),
        includeUnsaved: includeUnsaved.toString(),
      });
      
      // Only add productId if not "all"
      if (productFilter !== "all") {
        params.append('productId', productFilter);
      }
      
      const url = `/api/saved-images?${params}`;
      console.log('[Image Library] Fetching:', url, { productFilter, includeUnsaved, currentPage });
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Image Library] Fetch error:', response.status, errorText);
        throw new Error(`Failed to fetch images: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[Image Library] Received:', data);
      return data;
    },
  });

  const savedImages = imagesData?.items || [];
  const totalPages = imagesData?.totalPages || 1;
  const totalImages = imagesData?.total || 0;

  // Clamp currentPage to valid range when data changes (handles deletions leaving page empty)
  useEffect(() => {
    if (imagesData && imagesData.totalPages > 0 && currentPage > imagesData.totalPages) {
      setCurrentPage(Math.max(1, imagesData.totalPages));
    }
  }, [imagesData, currentPage]);

  // Save mutation (for unsaved images - changes status from "auto-generated" to "saved")
  const saveMutation = useMutation({
    mutationFn: async (imageId: string) => {
      return await apiRequest('PATCH', `/api/saved-images/${imageId}`, { status: 'saved' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-images'] });
      toast({
        title: "Success",
        description: "Image saved to library",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Save",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (imageId: string) => {
      return await apiRequest('DELETE', `/api/saved-images/${imageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-images'] });
      toast({
        title: "Success",
        description: "Image deleted from library",
      });
      setDeleteImageId(null);
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
      setDeleteImageId(null);
    },
  });

  // Group images by product for display
  const getProductName = (productId: string | null) => {
    if (!productId) return "No Product Association";
    const product = products.find(p => p.id === productId);
    return product?.name || "Unknown Product";
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Image Library</h1>
        <p className="text-muted-foreground">
          View and manage your saved marketing images
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="mtp" data-testid="tab-mtp-images">MTP-Images</TabsTrigger>
          <TabsTrigger value="generated" data-testid="tab-generated-images">Generated Images</TabsTrigger>
        </TabsList>

        <TabsContent value="generated" className="space-y-6">
          {/* Filter Controls */}
          <Card>
        <CardHeader>
          <CardTitle>Filter Images</CardTitle>
          <CardDescription>
            Filter by product association {totalImages > 0 && `(${totalImages} total images)`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product-filter">Filter by Product</Label>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger id="product-filter" className="max-w-sm" data-testid="select-filter-product">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-filter-all">All Images</SelectItem>
                <SelectItem value="none" data-testid="option-filter-none">No Product Association</SelectItem>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id} data-testid={`option-filter-${product.id}`}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="include-unsaved" 
              checked={includeUnsaved} 
              onCheckedChange={(checked) => setIncludeUnsaved(checked === true)}
              data-testid="checkbox-include-unsaved"
            />
            <Label 
              htmlFor="include-unsaved" 
              className="text-sm font-normal cursor-pointer"
            >
              Include unsaved images (Generated but not saved directly)
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Images Display */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="overflow-hidden">
              <CardContent className="p-0">
                <Skeleton className="w-full aspect-square" />
              </CardContent>
              <CardContent className="p-4 space-y-3">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-8 flex-1" />
                  <Skeleton className="h-8 flex-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : savedImages.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-muted-foreground">
              {productFilter === "all" 
                ? "No saved images yet. Generate and save images from the Image Generator page."
                : "No images found for this filter."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {savedImages.map((image) => (
              <Card key={image.id} className="overflow-hidden" data-testid={`card-image-${image.id}`}>
                <CardContent className="p-0">
                  <img
                    src={image.url}
                    alt={`Saved image from ${image.provider}`}
                    className="w-full aspect-square object-cover"
                    loading="lazy"
                  />
                </CardContent>
                <CardContent className="p-4 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Provider: <span className="text-muted-foreground">{image.provider === 'gpt' ? 'OpenAI' : image.provider === 'gemini' ? 'Gemini' : image.provider === 'nanobanana' ? 'Nano Banana Pro' : image.provider === 'nanobanana2' ? 'Nano Banana 2' : image.provider === 'imagen' ? 'Imagen 4' : image.provider}</span>
                    </p>
                    <p className="text-sm font-medium">
                      Product: <span className="text-muted-foreground">{getProductName(image.productId)}</span>
                    </p>
                    {image.revisedPrompt && (
                      <p className="text-xs text-muted-foreground mt-2">
                        <strong>Prompt:</strong> {image.revisedPrompt.length > 100 
                          ? `${image.revisedPrompt.substring(0, 100)}...` 
                          : image.revisedPrompt}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {image.status === 'auto-generated' && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => saveMutation.mutate(image.id)}
                        disabled={saveMutation.isPending}
                        className="flex-1"
                        data-testid={`button-save-${image.id}`}
                      >
                        Save
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailsImage(image)}
                      className="flex-1"
                      data-testid={`button-details-${image.id}`}
                    >
                      <Info className="mr-2 h-4 w-4" />
                      Details
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeleteImageId(image.id)}
                      className="flex-1"
                      data-testid={`button-delete-${image.id}`}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousPage}
                disabled={currentPage === 1}
                data-testid="button-previous-page"
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
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
        </TabsContent>

        <TabsContent value="mtp">
          <MTPImages />
        </TabsContent>
      </Tabs>

      {/* Image Details Dialog */}
      <Dialog open={!!detailsImage} onOpenChange={(open) => !open && setDetailsImage(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]" data-testid="dialog-image-details">
          <DialogHeader>
            <DialogTitle>Image Details</DialogTitle>
            <DialogDescription>
              View detailed information about this generated image
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-6 pr-4">
              {/* Generated Image */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Generated Image</h3>
                <img
                  src={detailsImage?.url}
                  alt="Generated marketing image"
                  className="w-full rounded-md border"
                  data-testid="img-generated"
                />
              </div>

              {/* Provider & Product Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Provider</h3>
                  <p className="text-sm text-muted-foreground" data-testid="text-provider">
                    {detailsImage?.provider === 'gpt' ? 'OpenAI DALL-E 3' : detailsImage?.provider === 'gemini' ? 'Google Gemini' : detailsImage?.provider === 'nanobanana' ? 'Nano Banana Pro' : detailsImage?.provider === 'nanobanana2' ? 'Nano Banana 2' : detailsImage?.provider === 'imagen' ? 'Imagen 4 Ultra' : detailsImage?.provider}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Product</h3>
                  <p className="text-sm text-muted-foreground" data-testid="text-product">
                    {getProductName(detailsImage?.productId || null)}
                  </p>
                </div>
              </div>

              {/* Original Prompt */}
              {detailsImage?.prompt && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Original Prompt</h3>
                  <div className="bg-muted p-3 rounded-md">
                    <p className="text-sm whitespace-pre-wrap" data-testid="text-prompt">
                      {detailsImage.prompt}
                    </p>
                  </div>
                </div>
              )}

              {/* Revised Prompt (if available) */}
              {detailsImage?.revisedPrompt && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">
                    Revised Prompt {detailsImage.provider === 'gpt' && '(OpenAI Enhanced)'}
                  </h3>
                  <div className="bg-muted p-3 rounded-md">
                    <p className="text-sm whitespace-pre-wrap" data-testid="text-revised-prompt">
                      {detailsImage.revisedPrompt}
                    </p>
                  </div>
                </div>
              )}

              {/* Reference Image (if used) */}
              {detailsImage?.referenceImageUrl && detailsImage.referenceImageUrl.trim() !== '' && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Reference Image Used</h3>
                  <img
                    src={detailsImage.referenceImageUrl}
                    alt="Reference image"
                    className="w-full max-w-md rounded-md border"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const parent = e.currentTarget.parentElement;
                      if (parent) {
                        parent.innerHTML = '<p class="text-sm text-muted-foreground">Reference image could not be loaded</p>';
                      }
                    }}
                    data-testid="img-reference"
                  />
                </div>
              )}

              {(!detailsImage?.referenceImageUrl || detailsImage.referenceImageUrl.trim() === '') && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Reference Image</h3>
                  <p className="text-sm text-muted-foreground" data-testid="text-no-reference">
                    No reference image was used for this generation
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteImageId} onOpenChange={(open) => !open && setDeleteImageId(null)}>
        <AlertDialogContent data-testid="dialog-delete-image">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this image from your library? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteImageId && deleteMutation.mutate(deleteImageId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
