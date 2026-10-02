import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { LicenseGate } from "./ui/LicenseGate";
import "./ui/license.css";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "./ui/styles.css";
import "./ui/workflow.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LicenseGate><App /></LicenseGate>
  </React.StrictMode>,
);
import "./ui/ios-controls.css";
