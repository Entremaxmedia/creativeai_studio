import { EmailLibraryCard } from "../email-library-card";

export default function EmailLibraryCardExample() {
  return (
    <div className="p-6 max-w-2xl space-y-4">
      <EmailLibraryCard
        id="1"
        subject="🎉 Exclusive 20% Off - Premium Headphones Just For You!"
        body="Hi there, We noticed you've been eyeing our Premium Wireless Headphones, and we wanted to make your decision easier! For the next 48 hours, enjoy an exclusive 20% discount..."
        productNames={["Wireless Headphones", "Smart Watch"]}
        rating="winning"
        openRate={45.2}
        clickRate={12.8}
        createdAt={new Date()}
        onView={(id) => console.log("View email:", id)}
        onDelete={(id) => console.log("Delete email:", id)}
        onReuse={(id) => console.log("Reuse email:", id)}
      />
      <EmailLibraryCard
        id="2"
        subject="New Arrivals: Check Out Our Latest Tech"
        body="Discover the newest additions to our tech collection. From cutting-edge laptops to innovative accessories, we have everything you need..."
        productNames={["Laptop Stand", "Mechanical Keyboard"]}
        rating="learning"
        openRate={28.5}
        clickRate={6.2}
        createdAt={new Date(Date.now() - 86400000)}
        onView={(id) => console.log("View email:", id)}
        onDelete={(id) => console.log("Delete email:", id)}
        onReuse={(id) => console.log("Reuse email:", id)}
      />
    </div>
  );
}
