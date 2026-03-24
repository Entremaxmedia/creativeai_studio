import { MetricCard } from "../metric-card";
import { Mail, Trophy, Package, TrendingUp } from "lucide-react";

export default function MetricCardExample() {
  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        title="Total Emails"
        value={156}
        icon={Mail}
        trend={12}
      />
      <MetricCard
        title="Winning Rate"
        value="34.6%"
        icon={Trophy}
        trend={8}
      />
      <MetricCard
        title="Products Featured"
        value={24}
        icon={Package}
        trend={-5}
      />
      <MetricCard
        title="Avg Performance"
        value="42.1%"
        icon={TrendingUp}
        trend={15}
      />
    </div>
  );
}
