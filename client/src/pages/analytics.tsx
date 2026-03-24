import { MetricCard } from "@/components/metric-card";
import { Mail, Trophy, Package, TrendingUp, Lightbulb, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface AnalyticsData {
  overall: {
    totalEmails: number;
    winners: number;
    losers: number;
    testing: number;
    needsTesting: number;
    overallWinRate: number;
  };
  byTone: Record<string, { total: number; winners: number; losers: number; winRate: number }>;
  byOfferType: Record<string, { total: number; winners: number; losers: number; winRate: number }>;
  topPerformer: {
    tone: string;
    winRate: number;
    tested: number;
  } | null;
  recentWinners: Array<{
    id: string;
    subject: string;
    tone: string;
    createdAt: Date;
  }>;
}

export default function AnalyticsPage() {
  const { data: analyticsResponse, isLoading } = useQuery<{ success: boolean; analytics: AnalyticsData }>({
    queryKey: ['/api/analytics'],
  });

  const analytics = analyticsResponse?.analytics;

  // Transform tone stats for bar chart
  const toneChartData = analytics ? Object.entries(analytics.byTone)
    .filter(([_, stats]) => (stats.winners + stats.losers) > 0) // Only show tested tones
    .map(([tone, stats]) => ({
      tone: formatToneName(tone),
      winRate: stats.winRate,
      tested: stats.winners + stats.losers,
    }))
    .sort((a, b) => b.winRate - a.winRate) : [];

  // Transform offer type stats for bar chart
  const offerTypeChartData = analytics ? Object.entries(analytics.byOfferType)
    .filter(([_, stats]) => (stats.winners + stats.losers) > 0)
    .map(([type, stats]) => ({
      type: type === 'free-shipping' ? 'F+S Offers' : 'Straight Sale',
      winRate: stats.winRate,
      tested: stats.winners + stats.losers,
    }))
    .sort((a, b) => b.winRate - a.winRate) : [];

  function formatToneName(tone: string): string {
    const toneLabels: Record<string, string> = {
      'legendary-copywriters': 'Legendary Copywriters',
      'national-brands': 'National Brands',
      'high-performing': 'High-Performing',
      'current-events': 'Current Events',
      'you-won': 'You Won!',
      'try-something-new': 'Try Something New',
      'review-based': 'Review Based',
      'story-time': 'Story-Time',
      'custom': 'Custom',
    };
    return toneLabels[tone] || tone;
  }

  // Generate insights based on real data
  const insights = analytics ? generateInsights(analytics) : [];
  const suggestions = analytics ? generateSuggestions(analytics) : [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Email Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Track performance and learn from your campaigns
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Email Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Track performance and learn from your campaigns
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              Unable to load analytics data
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Track performance and learn from your campaigns
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="Total Emails" 
          value={analytics.overall.totalEmails} 
          icon={Mail} 
          data-testid="metric-total-emails"
        />
        <MetricCard 
          title="Overall Win Rate" 
          value={analytics.overall.overallWinRate > 0 ? `${analytics.overall.overallWinRate}%` : 'N/A'} 
          icon={Trophy} 
          description={`${analytics.overall.winners} winners of ${analytics.overall.winners + analytics.overall.losers} tested`}
          data-testid="metric-win-rate"
        />
        <MetricCard 
          title="Winners" 
          value={analytics.overall.winners} 
          icon={Package} 
          description="Proven performers"
          data-testid="metric-winners"
        />
        <MetricCard 
          title="In Testing" 
          value={analytics.overall.testing} 
          icon={TrendingUp} 
          description={`${analytics.overall.needsTesting} need testing`}
          data-testid="metric-testing"
        />
      </div>

      {analytics.topPerformer && (
        <Card className="border-chart-2/20 bg-chart-2/5">
          <CardHeader className="gap-1 space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-chart-2" />
              Top Performing Tone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-semibold">{formatToneName(analytics.topPerformer.tone)}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {analytics.topPerformer.winRate}% win rate from {analytics.topPerformer.tested} tested emails
                </p>
              </div>
              <Badge className="bg-chart-2 text-white hover-elevate" data-testid="badge-top-performer">
                Champion
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="gap-1 space-y-0 pb-4">
            <CardTitle>Win Rate by Tone</CardTitle>
            <p className="text-sm text-muted-foreground">
              {toneChartData.length > 0 
                ? 'Performance of different copywriting styles' 
                : 'No tested emails yet'}
            </p>
          </CardHeader>
          <CardContent>
            {toneChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={toneChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" className="text-xs" domain={[0, 100]} />
                  <YAxis dataKey="tone" type="category" className="text-xs" width={120} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === 'winRate') return [`${value}%`, 'Win Rate'];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="winRate" fill="hsl(var(--chart-1))" name="Win Rate %" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Generate and test emails to see tone performance
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 space-y-0 pb-4">
            <CardTitle>Win Rate by Offer Type</CardTitle>
            <p className="text-sm text-muted-foreground">
              {offerTypeChartData.length > 0 
                ? 'F+S vs Straight Sale performance' 
                : 'No tested emails yet'}
            </p>
          </CardHeader>
          <CardContent>
            {offerTypeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={offerTypeChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="type" className="text-xs" />
                  <YAxis className="text-xs" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === 'winRate') return [`${value}%`, 'Win Rate'];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="winRate" fill="hsl(var(--chart-2))" name="Win Rate %" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Generate and test emails to see offer type performance
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="gap-1 space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-chart-2" />
              What's Working
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Patterns from your winning emails
            </p>
          </CardHeader>
          <CardContent>
            {insights.length > 0 ? (
              <ul className="space-y-3" data-testid="list-insights">
                {insights.map((insight, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-chart-2 mt-2 shrink-0" />
                    <span className="text-sm">{insight}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Mark some emails as "winner" to see winning patterns
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-chart-4" />
              AI Learning Suggestions
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              How to improve your campaigns
            </p>
          </CardHeader>
          <CardContent>
            {suggestions.length > 0 ? (
              <ul className="space-y-3" data-testid="list-suggestions">
                {suggestions.map((suggestion, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0 mt-0.5 bg-chart-4/10 text-chart-4 border-chart-4/20">
                      Tip
                    </Badge>
                    <span className="text-sm">{suggestion}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Test more emails to unlock AI-powered suggestions
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {analytics.recentWinners.length > 0 && (
        <Card>
          <CardHeader className="gap-1 space-y-0 pb-4">
            <CardTitle>Recent Winners</CardTitle>
            <p className="text-sm text-muted-foreground">
              Your latest successful campaigns
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3" data-testid="list-recent-winners">
              {analytics.recentWinners.map((winner) => (
                <div key={winner.id} className="flex items-center justify-between p-3 rounded-md border hover-elevate">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{winner.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatToneName(winner.tone)}
                    </p>
                  </div>
                  <Badge variant="outline" className="ml-2 bg-chart-2/10 text-chart-2 border-chart-2/20">
                    Winner
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function generateInsights(analytics: AnalyticsData): string[] {
  const insights: string[] = [];

  // Insight about top tone
  if (analytics.topPerformer) {
    insights.push(
      `${formatToneName(analytics.topPerformer.tone)} tone has the highest win rate at ${analytics.topPerformer.winRate}%`
    );
  }

  // Insight about offer types
  const offerTypes = Object.entries(analytics.byOfferType)
    .filter(([_, stats]) => (stats.winners + stats.losers) > 0)
    .sort((a, b) => b[1].winRate - a[1].winRate);
  
  if (offerTypes.length > 0) {
    const [topOfferType, topStats] = offerTypes[0];
    const offerLabel = topOfferType === 'free-shipping' ? 'Free-shipping' : 'Straight-sale';
    insights.push(`${offerLabel} offers perform best with ${topStats.winRate}% win rate`);
  }

  // Insight about total winners
  if (analytics.overall.winners > 0) {
    insights.push(`${analytics.overall.winners} winning campaigns identified and learning from their patterns`);
  }

  // Insight about testing
  if (analytics.overall.testing > 0) {
    insights.push(`${analytics.overall.testing} emails currently being tested in campaigns`);
  }

  return insights;
}

function generateSuggestions(analytics: AnalyticsData): string[] {
  const suggestions: string[] = [];

  // Suggest testing if many untested
  if (analytics.overall.needsTesting > 5) {
    suggestions.push(
      `You have ${analytics.overall.needsTesting} untested emails - start testing to build your winning database`
    );
  }

  // Suggest trying top tone
  if (analytics.topPerformer && analytics.topPerformer.winRate > 50) {
    suggestions.push(
      `${formatToneName(analytics.topPerformer.tone)} tone is performing well - generate more variations with this style`
    );
  }

  // Suggest trying underused tones
  const testedTones = Object.entries(analytics.byTone)
    .filter(([_, stats]) => (stats.winners + stats.losers) > 0);
  
  if (testedTones.length < 4) {
    suggestions.push('Try testing different tone options to discover what works best for your audience');
  }

  // General suggestion
  if (analytics.overall.winners > 0) {
    suggestions.push('The AI now learns from your winners - new generations will be influenced by proven patterns');
  } else {
    suggestions.push('Mark high-performing emails as "winner" to enable AI learning from successful campaigns');
  }

  return suggestions;
}

function formatToneName(tone: string): string {
  const toneLabels: Record<string, string> = {
    'legendary-copywriters': 'Legendary Copywriters',
    'national-brands': 'National Brands',
    'high-performing': 'High-Performing',
    'current-events': 'Current Events',
    'you-won': 'You Won!',
    'try-something-new': 'Try Something New',
    'review-based': 'Review Based',
    'story-time': 'Story-Time',
    'custom': 'Custom',
  };
  return toneLabels[tone] || tone;
}
