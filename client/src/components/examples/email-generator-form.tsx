import { EmailGeneratorForm } from "../email-generator-form";

export default function EmailGeneratorFormExample() {
  const mockProducts = [
    { id: "1", name: "Tactical Backpack", offerType: "straight-sale" },
    { id: "2", name: "Survival Kit", offerType: "free-plus-shipping" },
    { id: "3", name: "Hunting Knife", offerType: "straight-sale" },
    { id: "4", name: "Emergency Radio", offerType: "free-plus-shipping" },
  ];

  return (
    <div className="p-6 max-w-lg h-screen">
      <EmailGeneratorForm
        products={mockProducts}
        onGenerate={(config) => console.log("Generate with config:", config)}
      />
    </div>
  );
}
