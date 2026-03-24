import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, X, Bold, Italic, Underline, Link as LinkIcon } from "lucide-react";

interface EmailEditorProps {
  open: boolean;
  onClose: () => void;
  subjects: string[];
  body: string;
  htmlBody?: string;
  onSave: (edited: { subjects: string[]; body: string; htmlBody: string }) => void;
}

export function EmailEditor({
  open,
  onClose,
  subjects,
  body,
  htmlBody,
  onSave
}: EmailEditorProps) {
  const [editedSubjects, setEditedSubjects] = useState<string[]>(subjects);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only populate when dialog is opening (open === true)
    if (open) {
      setEditedSubjects(subjects);
      
      // Wait for the Dialog to render the contentEditable div to the DOM
      setTimeout(() => {
        if (editorRef.current) {
          console.log('EmailEditor OPENING - setting content');
          console.log('htmlBody:', htmlBody?.substring(0, 100));
          
          if (htmlBody) {
            // Decode HTML entities: &lt; becomes <, &gt; becomes >, etc.
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlBody;
            // innerHTML gives us the decoded HTML with all tags intact
            const decodedHtml = tempDiv.innerHTML;
            console.log('Setting decoded HTML, length:', decodedHtml.length);
            // Set the decoded HTML as the actual HTML content
            editorRef.current.innerHTML = decodedHtml;
            console.log('Content set! editorRef.current.innerHTML length:', editorRef.current.innerHTML.length);
          } else if (body) {
            console.log('Using body fallback');
            editorRef.current.innerHTML = body;
          } else {
            console.log('WARNING: No htmlBody or body provided!');
          }
        } else {
          console.log('ERROR: editorRef.current is still null after setTimeout');
        }
      }, 0);
    }
  }, [subjects, body, htmlBody, open]);

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const insertLink = () => {
    const url = prompt("Enter link URL:");
    if (url) {
      execCommand('createLink', url);
      // Apply styling to the created link
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const link = range.startContainer.parentElement;
        if (link?.tagName === 'A') {
          link.setAttribute('style', 'color:#0066cc');
        }
      }
    }
  };

  const handleSave = () => {
    const htmlContent = editorRef.current?.innerHTML || '';
    
    // Convert HTML to plain text for body field
    const plainText = editorRef.current?.innerText || '';
    
    onSave({
      subjects: editedSubjects,
      body: plainText,
      htmlBody: htmlContent
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Email</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto space-y-6">
          <div className="space-y-4">
            <Label>Subject Lines</Label>
            {editedSubjects.map((subject, idx) => (
              <div key={idx}>
                <Input
                  value={subject}
                  onChange={(e) => {
                    const newSubjects = [...editedSubjects];
                    newSubjects[idx] = e.target.value;
                    setEditedSubjects(newSubjects);
                  }}
                  placeholder={`Subject line ${idx + 1}`}
                  className="bg-white text-black"
                  data-testid={`input-subject-${idx}`}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Email Body</Label>
            
            {/* Formatting Toolbar */}
            <div className="flex items-center gap-1 p-2 border rounded-md bg-muted/50">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => execCommand('bold')}
                data-testid="button-bold"
                title="Bold"
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => execCommand('italic')}
                data-testid="button-italic"
                title="Italic"
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => execCommand('underline')}
                data-testid="button-underline"
                title="Underline"
              >
                <Underline className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={insertLink}
                data-testid="button-link"
                title="Insert Link"
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </div>

            {/* Rich Text Editor */}
            <div
              ref={editorRef}
              contentEditable
              className="min-h-[400px] p-4 border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ 
                fontFamily: 'sans-serif',
                fontSize: '14px',
                lineHeight: '1.6',
                color: '#000'
              }}
              onClick={(e) => {
                // Prevent links from being followed - allow editing instead
                if ((e.target as HTMLElement).tagName === 'A') {
                  e.preventDefault();
                }
              }}
              data-testid="editor-body"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            data-testid="button-save-edit"
          >
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
