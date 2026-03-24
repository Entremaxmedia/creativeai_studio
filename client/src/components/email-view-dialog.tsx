import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Pencil } from "lucide-react";
import type { Email } from "@shared/schema";

interface EmailViewDialogProps {
  email: Email | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (emailId: string) => void;
  productIdToName?: Map<string, string>;
}

export function EmailViewDialog({ email, open, onOpenChange, onEdit, productIdToName = new Map() }: EmailViewDialogProps) {

  if (!email) return null;

  const subjects = email.subjects || [email.subject];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-email-view">
        <DialogHeader>
          <DialogTitle>Email Details</DialogTitle>
          <DialogDescription>
            Review email content and performance metrics
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Subject Lines</h3>
            <div className="space-y-2">
              {subjects.map((subject, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <Badge variant="outline" className="shrink-0">
                    {idx + 1}
                  </Badge>
                  <p className="text-sm">{subject}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Email Content</h3>
            <Tabs defaultValue="preview" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="html">HTML</TabsTrigger>
              </TabsList>
              <TabsContent value="preview" className="mt-4">
                <Card className="p-4 bg-white dark:bg-white">
                  <div
                    className="prose prose-sm max-w-none text-black dark:text-black"
                    dangerouslySetInnerHTML={{ __html: email.htmlBody || email.body }}
                    data-testid="email-preview-content"
                  />
                </Card>
              </TabsContent>
              <TabsContent value="html" className="mt-4">
                <Card className="p-4">
                  <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                    <code>{email.htmlBody || email.body}</code>
                  </pre>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Offer</h3>
              <div className="flex flex-wrap gap-2">
                {email.productIds.map((id, idx) => (
                  <Badge key={idx} variant="secondary">
                    {productIdToName.get(id) || "Unknown Product"}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2">Tone/Angle</h3>
              <Badge variant="outline">{email.tone}</Badge>
            </div>
          </div>

          {(email.openRate !== null || email.clickRate !== null || email.conversionRate !== null) && (
            <div>
              <h3 className="text-sm font-medium mb-2">Performance Metrics</h3>
              <div className="grid grid-cols-3 gap-4">
                {email.openRate !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Open Rate</p>
                    <p className="text-lg font-semibold">{email.openRate}%</p>
                  </div>
                )}
                {email.clickRate !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Click Rate</p>
                    <p className="text-lg font-semibold">{email.clickRate}%</p>
                  </div>
                )}
                {email.conversionRate !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Conversion Rate</p>
                    <p className="text-lg font-semibold">{email.conversionRate}%</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {email.notes && (
            <div>
              <h3 className="text-sm font-medium mb-2">Notes</h3>
              <Card className="p-3">
                <p className="text-sm">{email.notes}</p>
              </Card>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Created: {new Date(email.createdAt).toLocaleString()}
            {email.editedAt && (
              <> • Edited: {new Date(email.editedAt).toLocaleString()}</>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onEdit?.(email.id);
              onOpenChange(false);
            }}
            data-testid="button-edit-from-view"
          >
            <Pencil className="h-4 w-4 mr-2" />
            Edit Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
