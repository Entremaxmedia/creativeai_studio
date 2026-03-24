import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, ExternalLink, Filter, Trash2 } from "lucide-react";
import { EmailLibraryCard } from "@/components/email-library-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Email, SavedImage } from "@shared/schema";

interface Product {
  id: string;
  name: string;
  displayName?: string | null;
  offerType: string;
  offerLink: string;
  manualContent: string;
  imageUrl: string | null;
}

interface ProductDetailsDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmailView: (email: Email) => void;
  onEmailDelete: (id: string) => void;
  onEmailReuse: (id: string) => void;
  onEmailStatusChange: (id: string, status: string) => void;
}

export function ProductDetailsDialog({
  product,
  open,
  onOpenChange,
  onEmailView,
  onEmailDelete,
  onEmailReuse,
  onEmailStatusChange,
}: ProductDetailsDialogProps) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [includeUnsaved, setIncludeUnsaved] = useState(false);
  const [deleteImageId, setDeleteImageId] = useState<string | null>(null);

  // Fetch all emails
  const { data: emailsData, isLoading } = useQuery<{ success: boolean; emails: Email[] }>({
    queryKey: ["/api/emails"],
    enabled: open && !!product,
    refetchOnMount: true,
    staleTime: 0,
  });

  // Fetch images for this product
  const { data: imagesData, isLoading: imagesLoading } = useQuery<{ success: boolean; savedImages: SavedImage[] }>({
    queryKey: ['/api/saved-images/product', product?.id, includeUnsaved],
    queryFn: async () => {
      const params = new URLSearchParams({
        includeUnsaved: includeUnsaved.toString(),
      });
      const response = await fetch(`/api/saved-images/product/${product?.id}?${params}`);
      if (!response.ok) throw new Error('Failed to fetch images');
      return response.json();
    },
    enabled: open && !!product,
  });
  const savedImages = imagesData?.savedImages || [];

  // Save mutation (for unsaved images - changes status from "auto-generated" to "saved")
  const saveMutation = useMutation({
    mutationFn: async (imageId: string) => {
      return await apiRequest('PATCH', `/api/saved-images/${imageId}`, { status: 'saved' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-images'] });
      if (product?.id) {
        queryClient.invalidateQueries({ queryKey: ['/api/saved-images/product', product.id] });
      }
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

  // Delete image mutation
  const deleteMutation = useMutation({
    mutationFn: async (imageId: string) => {
      return await apiRequest('DELETE', `/api/saved-images/${imageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-images'] });
      if (product?.id) {
        queryClient.invalidateQueries({ queryKey: ['/api/saved-images/product', product.id] });
      }
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

  if (!product) return null;

  const offerTypeLabel = product.offerType === "straight-sale" ? "Straight Sale" : "Free + Shipping";

  // Filter emails by product and status
  const productEmails = emailsData?.emails?.filter((email) => 
    email.productIds.includes(product.id)
  ) || [];

  const filteredEmails = statusFilter === "all" 
    ? productEmails 
    : productEmails.filter((email) => email.status === statusFilter);

  // Handler to convert id to email object for onView
  const handleViewEmail = (id: string) => {
    const email = productEmails.find((e) => e.id === id);
    if (email) {
      onEmailView(email);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-2xl">{product.name}</DialogTitle>
              <DialogDescription className="mt-2 flex items-center gap-2">
                <Badge variant="secondary">{offerTypeLabel}</Badge>
                {product.offerLink && (
                  <a
                    href={product.offerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View Offer
                  </a>
                )}
              </DialogDescription>
            </div>
            {product.imageUrl && (
              <div className="w-24 h-24 rounded-md overflow-hidden bg-muted flex-shrink-0">
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 min-h-0">
          {/* Product Details Section */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Product Details</h3>
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Offer Type</p>
                <p className="text-sm">{offerTypeLabel}</p>
              </div>
              {product.offerLink && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Offer Link</p>
                  <a
                    href={product.offerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline break-all"
                  >
                    {product.offerLink}
                  </a>
                </div>
              )}
              {product.manualContent && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Manual Content</p>
                  <p className="text-sm whitespace-pre-wrap max-h-32 overflow-y-auto border rounded-md p-3 bg-muted/30">
                    {product.manualContent}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Tabs for Emails and Images */}
          <Tabs defaultValue="emails" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="emails" data-testid="tab-emails">
                Emails ({filteredEmails.length})
              </TabsTrigger>
              <TabsTrigger value="images" data-testid="tab-images">
                Images ({savedImages.length})
              </TabsTrigger>
            </TabsList>

            {/* Emails Tab */}
            <TabsContent value="emails" className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-lg font-semibold">
                  Emails ({filteredEmails.length})
                </h3>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Emails</SelectItem>
                      <SelectItem value="needs-testing">Needs Testing</SelectItem>
                      <SelectItem value="testing">Testing</SelectItem>
                      <SelectItem value="winner">Winners</SelectItem>
                      <SelectItem value="loser">Losers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredEmails.length === 0 ? (
                <div className="text-center py-12 border rounded-md bg-muted/30">
                  <p className="text-muted-foreground">
                    {statusFilter === "all" 
                      ? "No emails saved for this product yet"
                      : `No emails with status: ${statusFilter}`}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredEmails.map((email) => (
                    <EmailLibraryCard
                      key={email.id}
                      id={email.id}
                      subject={email.subject}
                      body={email.body}
                      productNames={[product.name]}
                      status={email.status as "needs-review" | "document" | "needs-testing" | "testing" | "winner" | "loser" | undefined}
                      openRate={email.openRate ?? undefined}
                      clickRate={email.clickRate ?? undefined}
                      createdAt={new Date(email.createdAt)}
                      onView={handleViewEmail}
                      onDelete={onEmailDelete}
                      onReuse={onEmailReuse}
                      onStatusChange={onEmailStatusChange}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Images Tab */}
            <TabsContent value="images" className="space-y-3">
              <div className="flex items-center space-x-2 pb-2">
                <Checkbox 
                  id="include-unsaved-product" 
                  checked={includeUnsaved} 
                  onCheckedChange={(checked) => setIncludeUnsaved(checked === true)}
                  data-testid="checkbox-include-unsaved-product"
                />
                <Label 
                  htmlFor="include-unsaved-product" 
                  className="text-sm font-normal cursor-pointer"
                >
                  Include unsaved images (Generated but not saved directly)
                </Label>
              </div>

              {imagesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : savedImages.length === 0 ? (
                <div className="text-center py-12 border rounded-md bg-muted/30">
                  <p className="text-muted-foreground">
                    {includeUnsaved 
                      ? "No images for this product yet"
                      : "No saved images for this product yet"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {savedImages.map((image) => (
                    <Card key={image.id} className="overflow-hidden" data-testid={`card-image-${image.id}`}>
                      <CardContent className="p-0">
                        <img
                          src={image.url}
                          alt={`Saved image from ${image.provider}`}
                          className="w-full aspect-square object-cover"
                        />
                      </CardContent>
                      <CardContent className="p-3 space-y-2">
                        <div className="space-y-1">
                          <p className="text-xs font-medium">
                            Provider: <span className="text-muted-foreground">{image.provider === 'gpt' ? 'OpenAI' : 'Gemini'}</span>
                          </p>
                          {image.revisedPrompt && (
                            <p className="text-xs text-muted-foreground">
                              <strong>Prompt:</strong> {image.revisedPrompt.length > 80 
                                ? `${image.revisedPrompt.substring(0, 80)}...` 
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
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>

      {/* Delete Image Confirmation Dialog */}
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
    </Dialog>
  );
}
