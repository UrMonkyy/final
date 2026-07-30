const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AvatarResult = {
  username: string;
  userId: number | null;
  avatarUrl: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeUsername(value: unknown) {
  return String(value ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const rawUsernames = Array.isArray(payload.usernames)
      ? payload.usernames
      : [payload.username];

    const usernames = [...new Set(rawUsernames.map(normalizeUsername).filter(Boolean))].slice(0, 100);

    if (!usernames.length) {
      return jsonResponse({ avatars: [] });
    }

    const robloxApiKey = Deno.env.get("ROBLOX_API_KEY") || "";
    const robloxHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (robloxApiKey) {
      robloxHeaders["x-api-key"] = robloxApiKey;
    }

    const usernameResponse = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: robloxHeaders,
      body: JSON.stringify({
        usernames,
        excludeBannedUsers: false,
      }),
    });

    if (!usernameResponse.ok) {
      const detail = await usernameResponse.text().catch(() => "");
      throw new Error(`Roblox username lookup failed: ${usernameResponse.status} ${detail}`.trim());
    }

    const usernameJson = await usernameResponse.json();
    const users = Array.isArray(usernameJson?.data) ? usernameJson.data : [];

    const userByRequestedName = new Map<string, { id: number; name: string }>();
    users.forEach((user) => {
      const id = Number(user?.id);
      if (!id) return;
      const returnedName = normalizeUsername(user?.name).toLowerCase();
      const requestedName = normalizeUsername(user?.requestedUsername || user?.name).toLowerCase();
      if (requestedName) userByRequestedName.set(requestedName, { id, name: user.name });
      if (returnedName) userByRequestedName.set(returnedName, { id, name: user.name });
    });

    const userIds = [...new Set(usernames
      .map((username) => userByRequestedName.get(username.toLowerCase())?.id)
      .filter((id): id is number => Boolean(id)))];

    const avatarUrlByUserId = new Map<number, string>();
    if (userIds.length) {
      const thumbnailUrl = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(userIds.join(","))}&size=150x150&format=Png&isCircular=true`;
      const thumbnailResponse = await fetch(thumbnailUrl);

      if (!thumbnailResponse.ok) {
        const detail = await thumbnailResponse.text().catch(() => "");
        throw new Error(`Roblox thumbnail lookup failed: ${thumbnailResponse.status} ${detail}`.trim());
      }

      const thumbnailJson = await thumbnailResponse.json();
      const thumbnails = Array.isArray(thumbnailJson?.data) ? thumbnailJson.data : [];
      thumbnails.forEach((item) => {
        const userId = Number(item?.targetId);
        if (!userId) return;
        avatarUrlByUserId.set(userId, String(item?.imageUrl || ""));
      });
    }

    const avatars: AvatarResult[] = usernames.map((username) => {
      const user = userByRequestedName.get(username.toLowerCase());
      if (!user?.id) {
        return { username, userId: null, avatarUrl: "" };
      }
      return {
        username,
        userId: user.id,
        avatarUrl: avatarUrlByUserId.get(user.id) || "",
      };
    });

    return jsonResponse({ avatars });
  } catch (error) {
    return jsonResponse({ error: String(error?.message ?? error) }, 500);
  }
});
