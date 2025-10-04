import path from "path";
import { leagueDirectorySegment, teamProfileFileName } from "./teamprofiles.js";

export function resolveTeamProfilePath({ leagueName, teamName, matchType }) {
  const leagueDir = leagueDirectorySegment(leagueName);
  const fileName = teamProfileFileName(teamName, matchType);
  return path.join(process.cwd(), "data", "teamprofiles", leagueDir, fileName);
}