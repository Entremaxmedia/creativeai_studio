import { useState } from "react";
import { ProductFormModal } from "../product-form-modal";
import { Button } from "@/components/ui/button";

export default function ProductFormModalExample() {
  const [open, setOpen] = useState(false);

  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open Product Form</Button>
      <ProductFormModal
        open={open}
        onOpenChange={setOpen}
        onSubmit={(data) => console.log("Submitted:", data)}
      />
    </div>
  );
}
