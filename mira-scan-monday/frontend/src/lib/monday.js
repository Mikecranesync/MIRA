import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

export async function getMondayContext() {
  try {
    const ctx = await monday.get("context");
    const session = await monday.get("sessionToken").catch(() => ({ data: null }));
    return {
      ...ctx,
      sessionToken: session?.data || null,
    };
  } catch (err) {
    console.warn("monday context unavailable (running outside iframe?)", err);
    return { data: null, sessionToken: null };
  }
}

export default monday;
