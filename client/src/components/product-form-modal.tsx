import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";

interface ProductFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (product: ProductFormData) => void;
  initialData?: ProductFormData;
}

export interface ProductFormData {
  name: string;
  displayName: string;
  offerType: string;
  offerLink: string;
  manualContent: string;
  imageUrl: string;
}

export function ProductFormModal({
  open,
  onOpenChange,
  onSubmit,
  initialData,
}: ProductFormModalProps) {
  const [formData, setFormData] = useState<ProductFormData>({
    name: "",
    displayName: "",
    offerType: "",
    offerLink: "",
    manualContent: "",
    imageUrl: "",
  });
  const [isSuggestingName, setIsSuggestingName] = useState(false);
  const [userEditedDisplayName, setUserEditedDisplayName] = useState(false);

  // Update form data when initialData changes or modal opens
  useEffect(() => {
    if (open) {
      setFormData(initialData || {
        name: "",
        displayName: "",
        offerType: "",
        offerLink: "",
        manualContent: "",
        imageUrl: "",
      });
      // If editing an existing product with a displayName, treat it as user-edited
      setUserEditedDisplayName(!!initialData?.displayName);
    }
  }, [initialData, open]);

  // Auto-suggest display name when manual content is filled
  const suggestDisplayName = async (manualContent: string, internalName: string) => {
    if (!manualContent || manualContent.trim().length < 20 || !internalName) {
      return;
    }

    // Don't override if user has manually edited the display name
    if (userEditedDisplayName) {
      return;
    }

    setIsSuggestingName(true);
    try {
      const response = await fetch("/api/suggest-display-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualContent, internalName }),
      });

      const data = await response.json();
      
      // Double-check: only update if user hasn't typed in the field during the request
      if (data.success && data.displayName && !userEditedDisplayName) {
        setFormData(prev => ({ ...prev, displayName: data.displayName }));
      }
    } catch (error) {
      console.error("Failed to suggest display name:", error);
      // Silent fail - don't interrupt user workflow
    } finally {
      setIsSuggestingName(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all required fields (displayName is optional)
    if (!formData.name || !formData.offerType || !formData.offerLink || !formData.manualContent || !formData.imageUrl) {
      return; // Form validation will show required field errors
    }
    
    onSubmit?.(formData);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initialData ? "Edit Product" : "Add New Product"}
          </DialogTitle>
          <DialogDescription>
            AI will audit the offer link to determine pricing, deal details, and optimal CTAs
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Product Name (Internal)</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="e.g., Tacright GasMask High Ticket"
              required
              data-testid="input-product-name"
            />
            <p className="text-xs text-muted-foreground">
              Internal reference name for organizing your products
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="display-name" className="flex items-center gap-2">
              Email Product Name (Optional)
              {isSuggestingName && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </Label>
            <div className="relative">
              <Input
                id="display-name"
                value={formData.displayName}
                onChange={(e) => {
                  setFormData({ ...formData, displayName: e.target.value });
                  setUserEditedDisplayName(true);
                }}
                placeholder="e.g., Tacright GasMask (AI will suggest this)"
                data-testid="input-display-name"
              />
              {formData.displayName && !userEditedDisplayName && (
                <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              AI suggests this from your sales content. Edit if needed, or leave blank to use full name.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offer-type">Type of Offer</Label>
            <Select
              value={formData.offerType}
              onValueChange={(value) =>
                setFormData({ ...formData, offerType: value })
              }
            >
              <SelectTrigger id="offer-type" data-testid="select-offer-type">
                <SelectValue placeholder="Select offer type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="straight-sale">Straight Sale</SelectItem>
                <SelectItem value="free-plus-shipping">Free + Shipping (F+S)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This helps AI determine the best email approach and CTA
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offer-link">Link to Offer</Label>
            <Input
              id="offer-link"
              type="url"
              value={formData.offerLink}
              onChange={(e) =>
                setFormData({ ...formData, offerLink: e.target.value })
              }
              placeholder="https://example.com/product-page"
              required
              data-testid="input-offer-link"
            />
            <p className="text-xs text-muted-foreground">
              AI will analyze this page to extract deal details, retail price, and product features
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="image-url">Product Image URL</Label>
            <Input
              id="image-url"
              type="url"
              value={formData.imageUrl}
              onChange={(e) =>
                setFormData({ ...formData, imageUrl: e.target.value })
              }
              placeholder="https://example.com/product-image.jpg"
              required
              data-testid="input-image-url"
            />
            <p className="text-xs text-muted-foreground">
              Direct link to product image
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-content">
              Sales Page Content <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="manual-content"
              value={formData.manualContent}
              onChange={(e) =>
                setFormData({ ...formData, manualContent: e.target.value })
              }
              onBlur={(e) => {
                // Auto-suggest display name when user finishes entering content
                if (formData.name && e.target.value.trim().length > 20) {
                  suggestDisplayName(e.target.value, formData.name);
                }
              }}
              placeholder="Paste the entire sales page text here (title, price, features, description, etc.)&#10;&#10;Include: price, features, urgency text, and product description."
              className="min-h-[200px] font-mono text-sm"
              required
              data-testid="textarea-manual-content"
            />
            <p className="text-xs text-muted-foreground">
              This content is required. AI will use it to extract product details and suggest an email name.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" data-testid="button-submit">
              {initialData ? "Update Product" : "Add Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
