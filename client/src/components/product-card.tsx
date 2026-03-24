import { Package, Edit, Trash2, ExternalLink, Eye } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ProductCardProps {
  id: string;
  name: string;
  displayName?: string | null;
  offerType: string;
  offerLink: string;
  imageUrl?: string | null;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
}

export function ProductCard({
  id,
  name,
  offerType,
  offerLink,
  imageUrl,
  onEdit,
  onDelete,
  onSelect,
  onOpen,
}: ProductCardProps) {
  const offerTypeLabel = offerType === "straight-sale" ? "Straight Sale" : "Free + Shipping";
  
  return (
    <Card
      className="overflow-hidden hover-elevate active-elevate-2 cursor-pointer"
      onClick={() => onSelect?.(id)}
      data-testid={`card-product-${id}`}
    >
      <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback to icon if image fails to load
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement!.innerHTML = '<svg class="h-16 w-16 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
            }}
          />
        ) : (
          <Package className="h-16 w-16 text-muted-foreground" />
        )}
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold text-base break-words mb-2" data-testid={`text-product-name-${id}`}>
          {name}
        </h3>
        <Badge variant="secondary">
          {offerTypeLabel}
        </Badge>
      </CardContent>
      <CardFooter className="p-4 pt-0 gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          onClick={(e) => {
            e.stopPropagation();
            onOpen?.(id);
          }}
          data-testid={`button-open-${id}`}
        >
          <Eye className="h-3 w-3 mr-1" />
          Open
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.(id);
          }}
          data-testid={`button-edit-${id}`}
        >
          <Edit className="h-3 w-3 mr-1" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(id);
          }}
          data-testid={`button-delete-${id}`}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Delete
        </Button>
        <Button
          size="sm"
          variant="outline"
          asChild
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-view-offer-${id}`}
        >
          <a
            href={offerLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View Offer
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}
