"use client";

import { useState } from "react";
import { SWRConfig } from "swr";
import styles from "./page.module.css";
import RazBottomNav from "./RazBottomNav";
import RazMatchesClient from "./RazMatchesClient";

export default function RazShell({ fallback, defaultDate, resetKeys = [] }) {
  const [activeTab, setActiveTab] = useState("home");
  return (
    <div className={styles.razPage}>
      <div className={styles.razContent}>
        <SWRConfig value={{ fallback }}>
          <RazMatchesClient
            defaultDate={defaultDate}
            initialFallback={fallback}
            activeTab={activeTab}
            resetKeys={resetKeys}
          />
        </SWRConfig>
      </div>
      <RazBottomNav activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
}
