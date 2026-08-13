import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, BarChart, Bar, XAxis, YAxis } from "recharts";

export interface SkillRadarPoint {
  skill: string;
  value: number;
}

export interface WinLossBar {
  label: string;
  value: number;
  fill: string;
}

/** Split out of Players.tsx so recharts (~390KB) is only ever fetched once a player's
 *  detail view is actually opened, not just from browsing the roster list. */
const PlayerStatsCharts = ({ skillRadarData, winLossData }: { skillRadarData: SkillRadarPoint[]; winLossData: WinLossBar[] }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <div className="bg-card rounded-xl border border-border p-4">
      <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Skill Profil</h3>
      <ResponsiveContainer width="100%" height={180}>
        <RadarChart data={skillRadarData}>
          <PolarGrid stroke="hsl(222 18% 14%)" />
          <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: "hsl(222 12% 50%)" }} />
          <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
          <Radar dataKey="value" stroke="hsl(185 85% 48%)" fill="hsl(185 85% 48%)" fillOpacity={0.15} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>

    <div className="bg-card rounded-xl border border-border p-4">
      <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Siege / Niederlagen</h3>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={winLossData} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} width={80} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export default PlayerStatsCharts;
