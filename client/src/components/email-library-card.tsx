import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Trash2, Copy, TestTube2, Trophy, FlaskConical, X, Pencil, Link2, FileText, FileClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EmailLibraryCardProps {
  id: string;
  subject: string;
  body: string;
  productNames: string[];
  status?: "needs-review" | "document" | "needs-testing" | "testing" | "winner" | "loser";
  openRate?: number;
  clickRate?: number;
  createdAt: Date;
  onView?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onReuse?: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
}

const statusConfig = {
  "needs-review": {
    icon: FileClock,
    label: "Needs Review",
    variant: "secondary" as const,
    className: "bg-yellow-500/20 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
  },
  document: {
    icon: FileText,
    label: "Document",
    variant: "secondary" as const,
    className: "bg-blue-500/20 hover:bg-blue-500/20 text-blue-700 dark:text-blue-400",
  },
  "needs-testing": {
    icon: FlaskConical,
    label: "Needs Testing",
    variant: "secondary" as const,
    className: "bg-muted hover:bg-muted text-muted-foreground",
  },
  testing: {
    icon: TestTube2,
    label: "Testing",
    variant: "secondary" as const,
    className: "bg-chart-4 hover:bg-chart-4 text-white",
  },
  winner: {
    icon: Trophy,
    label: "Winner",
    variant: "default" as const,
    className: "bg-chart-2 hover:bg-chart-2 text-white",
  },
  loser: {
    icon: X,
    label: "Loser",
    variant: "destructive" as const,
    className: "bg-destructive hover:bg-destructive text-destructive-foreground",
  },
};

export function EmailLibraryCard({
  id,
  subject,
  body,
  productNames,
  status = "needs-review",
  openRate,
  clickRate,
  createdAt,
  onView,
  onEdit,
  onDelete,
  onReuse,
  onStatusChange,
}: EmailLibraryCardProps) {
  const { toast } = useToast();
  const config = statusConfig[status] || statusConfig["needs-review"];
  const StatusIcon = config.icon;

  const handleShare = () => {
    const shareUrl = `${window.location.origin}/library?email=${id}`;
    navigator.clipboard.writeText(shareUrl);
    toast({
      title: "Link copied!",
      description: "Shareable link copied to clipboard",
    });
  };

  return (
    <Card className="hover-elevate active-elevate-2" data-testid={`card-email-${id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-base line-clamp-1" data-testid={`text-email-subject-${id}`}>
                {subject}
              </h3>
              <Select
                value={status}
                onValueChange={(value) => onStatusChange?.(id, value)}
              >
                <SelectTrigger 
                  className={`h-5 text-xs px-2 gap-1 border-0 w-auto ${config.className}`}
                  data-testid={`select-status-${id}`}
                >
                  <SelectValue>
                    <div className="flex items-center gap-1">
                      <StatusIcon className="h-3 w-3" />
                      <span className="text-xs">{config.label}</span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="needs-review" data-testid="status-needs-review">
                    <div className="flex items-center gap-2">
                      <FileClock className="h-3 w-3" />
                      Needs Review
                    </div>
                  </SelectItem>
                  <SelectItem value="document" data-testid="status-document">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3 w-3" />
                      Document
                    </div>
                  </SelectItem>
                  <SelectItem value="needs-testing" data-testid="status-needs-testing">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-3 w-3" />
                      Needs Testing
                    </div>
                  </SelectItem>
                  <SelectItem value="testing" data-testid="status-testing">
                    <div className="flex items-center gap-2">
                      <TestTube2 className="h-3 w-3" />
                      Testing
                    </div>
                  </SelectItem>
                  <SelectItem value="winner" data-testid="status-winner">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-3 w-3" />
                      Winner
                    </div>
                  </SelectItem>
                  <SelectItem value="loser" data-testid="status-loser">
                    <div className="flex items-center gap-2">
                      <X className="h-3 w-3" />
                      Loser
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {body.substring(0, 120)}...
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {productNames.map((name, idx) => (
            <Badge key={idx} variant="outline" className="text-xs">
              {name}
            </Badge>
          ))}
        </div>

        {(openRate !== undefined || clickRate !== undefined) && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            {openRate !== undefined && (
              <div>
                <span className="font-medium">Open:</span> {openRate}%
              </div>
            )}
            {clickRate !== undefined && (
              <div>
                <span className="font-medium">Click:</span> {clickRate}%
              </div>
            )}
            <div className="ml-auto">
              {createdAt.toLocaleDateString()}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onView?.(id)}
            data-testid={`button-view-${id}`}
          >
            <Eye className="h-3 w-3 mr-1" />
            View
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit?.(id)}
            data-testid={`button-edit-${id}`}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleShare}
            data-testid={`button-share-${id}`}
          >
            <Link2 className="h-3 w-3 mr-1" />
            Share
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReuse?.(id)}
            data-testid={`button-reuse-${id}`}
          >
            <Copy className="h-3 w-3 mr-1" />
            Re-use
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDelete?.(id)}
            data-testid={`button-delete-email-${id}`}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
