import { defineCliConfig } from "sanity/cli";

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID || "xmn0tjwm",
    dataset: process.env.SANITY_STUDIO_DATASET || "production",
  },
  // `npm run deploy` publishes the Studio at https://mashuphost.sanity.studio
  studioHost: "mashuphost",
  deployment: { autoUpdates: true },
});
