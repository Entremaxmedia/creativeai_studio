import { ProductCard } from "../product-card";

export default function ProductCardExample() {
  return (
    <div className="p-6 max-w-sm">
      <ProductCard
        id="1"
        name="Tactical Backpack"
        offerType="straight-sale"
        offerLink="https://example.com/tactical-backpack"
        onEdit={(id) => console.log("Edit product:", id)}
        onDelete={(id) => console.log("Delete product:", id)}
        onSelect={(id) => console.log("Select product:", id)}
      />
    </div>
  );
}
