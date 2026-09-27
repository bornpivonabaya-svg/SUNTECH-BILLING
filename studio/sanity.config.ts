import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./schemaTypes";

const projectId = process.env.SANITY_STUDIO_PROJECT_ID || "";
const dataset = process.env.SANITY_STUDIO_DATASET || "production";

/** The homepage is one document with a fixed id ("homepage"), which is what the website reads. */
const SINGLETONS = new Set(["homepage"]);

export default defineConfig({
  name: "mashuphost",
  title: "MashupHost website",
  projectId,
  dataset,
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Website")
          .items([S.listItem().title("Homepage").id("homepage").child(S.document().schemaType("homepage").documentId("homepage").title("Homepage"))]),
    }),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
    // No "new homepage" in the create menu: there is exactly one.
    templates: (templates) => templates.filter(({ schemaType }) => !SINGLETONS.has(schemaType)),
  },
  document: {
    // Nor duplicate or delete for it — only edit and publish.
    actions: (actions, { schemaType }) =>
      SINGLETONS.has(schemaType) ? actions.filter(({ action }) => action && ["publish", "discardChanges", "restore"].includes(action)) : actions,
  },
});
