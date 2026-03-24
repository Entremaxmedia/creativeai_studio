import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Email, Product } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Plus } from "lucide-react";
import { RichTextEditor } from "@/components/rich-text-editor";

interface EmailEditDialogProps {
  email: Email | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    productIds: string[];
    subjects: string[];
    subject: string;
    body: string;
    htmlBody?: string;
  }) => void;
}

export function EmailEditDialog({
  email,
  open,
  onOpenChange,
  onSave,
}: EmailEditDialogProps) {
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [bodyHtml, setBodyHtml] = useState("");

  // Fetch products
  const { data: productsData } = useQuery<{ success: boolean; products: Product[] }>({
    queryKey: ["/api/products"],
  });

  const products = productsData?.products || [];

  // Convert plain text body to HTML if needed
  const convertBodyToHtml = (body: string): string => {
    // If already has HTML tags, return as is
    if (body.includes("<p>") || body.includes("<a ") || body.includes("<strong>") || body.includes("<em>")) {
      return body;
    }
    
    // Split by triple line breaks (paragraph separators) and convert to HTML
    const paragraphs = body.split('\n\n\n').filter(p => p.trim());
    // Convert internal newlines to <br> tags within each paragraph
    return paragraphs
      .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
      .join('');
  };

  // Convert HTML body back to plain text for storage
  const convertHtmlToBody = (html: string): string => {
    if (!html || html.trim().length === 0) {
      return "";
    }
    
    // Create a temporary div to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Check if there are paragraph tags
    const paragraphs = Array.from(temp.querySelectorAll('p'));
    
    if (paragraphs.length > 0) {
      // If there are paragraphs, extract their innerHTML
      return paragraphs
        .map(p => p.innerHTML.trim())
        .filter(text => text.length > 0)
        .join('\n\n\n');
    } else {
      // If no paragraphs, just return the innerHTML (preserving inline formatting)
      return temp.innerHTML.trim();
    }
  };

  // Initialize form when email changes
  useEffect(() => {
    if (email) {
      setSelectedProductId(email.productIds[0] || "");
      setSubjects(email.subjects || [email.subject]);
      setBodyHtml(convertBodyToHtml(email.body));
    }
  }, [email]);

  if (!email) return null;

  const handleAddSubject = () => {
    setSubjects([...subjects, ""]);
  };

  const handleRemoveSubject = (index: number) => {
    setSubjects(subjects.filter((_, i) => i !== index));
  };

  const handleSubjectChange = (index: number, value: string) => {
    const newSubjects = [...subjects];
    newSubjects[index] = value;
    setSubjects(newSubjects);
  };

  // Check if body has text content
  const hasBodyContent = (): boolean => {
    const temp = document.createElement('div');
    temp.innerHTML = bodyHtml;
    const textContent = temp.textContent || temp.innerText || '';
    return textContent.trim().length > 0;
  };

  // Generate HTML body with proper paragraph wrapping
  const generateHtmlBody = (bodyContent: string): string => {
    // Split by triple line breaks and wrap each paragraph
    const paragraphs = bodyContent.split('\n\n\n').filter(p => p.trim());
    return paragraphs
      .map(p => `<p style='margin:0 0 16px; line-height:1.6; color:#000;'>${p.trim()}</p>`)
      .join('');
  };

  const handleSave = () => {
    const validSubjects = subjects.filter((s) => s.trim());
    const plainTextBody = convertHtmlToBody(bodyHtml);
    const htmlBody = generateHtmlBody(plainTextBody);
    
    if (validSubjects.length === 0 || !plainTextBody.trim() || !selectedProductId) {
      return;
    }

    onSave({
      productIds: [selectedProductId],
      subjects: validSubjects,
      subject: validSubjects[0],
      body: plainTextBody,
      htmlBody,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Email</DialogTitle>
          <DialogDescription>
            Update the product, subject lines, and email copy
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Product Selection */}
          <div className="space-y-2">
            <Label htmlFor="edit-product">Product</Label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger id="edit-product" data-testid="select-edit-product">
                <SelectValue placeholder="Select product" />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subject Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Subject Lines</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddSubject}
                data-testid="button-add-subject"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Subject
              </Button>
            </div>
            <div className="space-y-2">
              {subjects.map((subject, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={subject}
                    onChange={(e) => handleSubjectChange(index, e.target.value)}
                    placeholder={`Subject line ${index + 1}`}
                    data-testid={`input-subject-${index}`}
                  />
                  {subjects.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => handleRemoveSubject(index)}
                      data-testid={`button-remove-subject-${index}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Email Body */}
          <div className="space-y-2">
            <Label>Email Body</Label>
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Enter email body..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            data-testid="button-save-edit"
            disabled={
              subjects.filter((s) => s.trim()).length === 0 ||
              !hasBodyContent() ||
              !selectedProductId
            }
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
