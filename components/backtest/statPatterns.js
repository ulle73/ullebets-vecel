export const getStatPatterns = (t) => ({
  totalShots: {
    displayName: t("stat_total_shots"),
    rankKey: "totalShotsOnGoal",
    keys: ["totalshots", "totalshotsongoal"],
    names: ["total shots"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5];
        if (period === "1ST") return [8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5];  
        if (period === "2ND") return [8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
      } else {
        if (period === "ALL") return [8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
      }
      return [];
    },
  },
  shotsOnGoal: {
    displayName: t("stat_total_shots_on_target"),
    keys: ["shotsongoal"],
    names: ["shots on goal", "shots on target"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
        if (period === "1ST") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
        if (period === "2ND") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
      } else {
        if (period === "ALL") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
        if (period === "1ST") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "2ND") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
      }
      return [];
    },
  },
  cornerKicks: {
    displayName: t("stat_corner_kicks"),
    keys: ["cornerkicks"],
    names: ["corner kicks", "corners"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
      } else {
        if (period === "ALL") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
        if (period === "1ST") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
        if (period === "2ND") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
      }
      return [];
    },
  },
  yellowCards: {
    displayName: t("stat_yellow_cards"),
    keys: ["yellowcards"],
    names: ["yellow cards"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
        if (period === "1ST") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "2ND") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
      } else {
        if (period === "ALL") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "1ST") return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
        if (period === "2ND") return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
      }
      return [];
    },
  },
  throwIns: {
    displayName: t("stat_throw_ins"),
    keys: ["throwins"],
    names: ["throw-ins"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5];
        if (period === "1ST") return [15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
        if (period === "2ND") return [15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
      } else {
        if (period === "ALL") return [15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
        if (period === "1ST") return [7.5, 8.5, 9.5, 10.5, 11.5, 12.5];
        if (period === "2ND") return [7.5, 8.5, 9.5, 10.5, 11.5, 12.5];
      }
      return [];
    },
  },
  freeKicks: {
    displayName: t("stat_free_kicks"),
    keys: ["freekicks"],
    names: ["free kicks"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [
            20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5,
          ];
        if (period === "1ST") return [10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
        if (period === "2ND") return [10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
      } else {
        if (period === "ALL") return [10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
        if (period === "1ST") return [5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
        if (period === "2ND") return [5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
      }
      return [];
    },
  },
  fouls: {
    displayName: t("stat_fouls"),
    keys: ["fouls"],
    names: ["fouls"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5];
        if (period === "1ST") return [9.5, 10.5, 11.5, 12.5, 13.5];
        if (period === "2ND") return [9.5, 10.5, 11.5, 12.5, 13.5];
      } else {
        if (period === "ALL") return [9.5, 10.5, 11.5, 12.5, 13.5, 14.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5];
      }
      return [];
    },
  },
  totalTackle: {
    displayName: t("stat_tackles"),
    keys: ["totaltackle", "tackles"],
    names: ["tackles", "total tackles"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5];
        if (period === "1ST") return [10.5, 11.5, 12.5, 13.5, 14.5];
        if (period === "2ND") return [10.5, 11.5, 12.5, 13.5, 14.5];
      } else {
        if (period === "ALL") return [9.5, 10.5, 11.5, 12.5, 13.5, 14.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5];
      }
      return [];
    },
  },
  offsides: {
    displayName: t("stat_offsides"),
    keys: ["offsides"],
    names: ["offsides"],
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "1ST") return [0.5, 1.5, 2.5, 3.5];
        if (period === "2ND") return [0.5, 1.5, 2.5, 3.5];
      } else {
        if (period === "ALL") return [1.5, 2.5, 3.5, 4.5];
        if (period === "1ST") return [0.5, 1.5, 2.5];
        if (period === "2ND") return [0.5, 1.5, 2.5];
      }
      return [];
    },
  },
});
