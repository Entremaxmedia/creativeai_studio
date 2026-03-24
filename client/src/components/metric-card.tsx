import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: number;
  description?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
}: MetricCardProps) {
  const isPositive = trend !== undefined && trend > 0;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`text-metric-${title.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs ${isPositive ? "text-chart-2" : "text-chart-5"}`}>
            <TrendIcon className="h-3 w-3" />
            <span>{Math.abs(trend)}%</span>
            <span className="text-muted-foreground">vs last period</span>
          </div>
        )}
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
