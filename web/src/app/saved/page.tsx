import type { Metadata } from "next";
import SavedClient from "./SavedClient";

export const metadata: Metadata = { title: "Saved test" };

export default function Page() {
  return <SavedClient />;
}
