import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Underline, Link as LinkIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Enter text...",
  className,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const savedSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const execCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleInput();
  };

  const handleBold = (e: React.MouseEvent) => {
    e.preventDefault();
    saveSelection();
    setTimeout(() => {
      restoreSelection();
      execCommand("bold");
    }, 0);
  };
  
  const handleItalic = (e: React.MouseEvent) => {
    e.preventDefault();
    saveSelection();
    setTimeout(() => {
      restoreSelection();
      execCommand("italic");
    }, 0);
  };
  
  const handleUnderline = (e: React.MouseEvent) => {
    e.preventDefault();
    saveSelection();
    setTimeout(() => {
      restoreSelection();
      execCommand("underline");
    }, 0);
  };

  const saveSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedSelectionRef.current = selection.getRangeAt(0);
    }
  };

  const restoreSelection = () => {
    if (savedSelectionRef.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedSelectionRef.current);
    }
  };

  const handleLinkClick = (e: React.MouseEvent) => {
    e.preventDefault();
    saveSelection();
    const selection = window.getSelection();
    const selectedText = selection?.toString() || "";
    setLinkText(selectedText);
    setLinkUrl("");
    setLinkDialogOpen(true);
  };

  const handleInsertLink = () => {
    if (!linkUrl.trim()) return;

    restoreSelection();

    if (linkText.trim()) {
      // Get the selected range to check if it has HTML formatting
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      
      let linkContent = linkText;
      
      // If there's a range, extract the HTML content to preserve formatting
      if (range) {
        const fragment = range.cloneContents();
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(fragment);
        
        // If the content has HTML tags (formatting), use it; otherwise use plain text
        if (tempDiv.innerHTML.includes('<')) {
          linkContent = tempDiv.innerHTML;
        }
      }
      
      const linkHtml = `<a href="${linkUrl}" style="color: #0066cc; text-decoration: underline;">${linkContent}</a>`;
      document.execCommand("insertHTML", false, linkHtml);
    } else {
      execCommand("createLink", linkUrl);
      const links = editorRef.current?.querySelectorAll('a[href="' + linkUrl + '"]');
      links?.forEach((link) => {
        (link as HTMLElement).style.color = "#0066cc";
        (link as HTMLElement).style.textDecoration = "underline";
      });
    }

    setLinkDialogOpen(false);
    setLinkText("");
    setLinkUrl("");
    editorRef.current?.focus();
    handleInput();
  };

  return (
    <>
      <div className={cn("border rounded-md", className)}>
        {/* Toolbar */}
        <div className="flex items-center gap-1 p-2 border-b bg-muted/30">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={handleBold}
            title="Bold"
            data-testid="button-format-bold"
            className="h-8 w-8"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={handleItalic}
            title="Italic"
            data-testid="button-format-italic"
            className="h-8 w-8"
          >
            <Italic className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={handleUnderline}
            title="Underline"
            data-testid="button-format-underline"
            className="h-8 w-8"
          >
            <Underline className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-border mx-1" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={handleLinkClick}
            title="Insert Link"
            data-testid="button-format-link"
            className="h-8 w-8"
          >
            <LinkIcon className="h-4 w-4" />
          </Button>
        </div>

        {/* Editor */}
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          className="min-h-[300px] p-3 focus:outline-none"
          data-testid="editor-content"
          suppressContentEditableWarning
        />
        
        {!value && (
          <div className="absolute top-14 left-3 text-muted-foreground pointer-events-none">
            {placeholder}
          </div>
        )}
      </div>

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert Link</DialogTitle>
            <DialogDescription>
              Add a hyperlink to your email
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="link-text">Link Text</Label>
              <Input
                id="link-text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="Click here"
                data-testid="input-link-text"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                data-testid="input-link-url"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLinkDialogOpen(false)}
              data-testid="button-cancel-link"
            >
              Cancel
            </Button>
            <Button
              onClick={handleInsertLink}
              disabled={!linkUrl.trim()}
              data-testid="button-insert-link"
            >
              Insert Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
