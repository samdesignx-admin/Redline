import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import RedlineApp from "./RedlineApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RedlineApp />
    <Analytics />
  </React.StrictMode>
);
