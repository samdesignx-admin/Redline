import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import UxnestApp from "./UxnestApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <UxnestApp />
    <Analytics />
  </React.StrictMode>
);
