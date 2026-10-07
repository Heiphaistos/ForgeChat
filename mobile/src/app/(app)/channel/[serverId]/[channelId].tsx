import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { serversApi } from "@/api/servers";
import { ErrorState, IconButton } from "@/components/ui";
import { ChatView } from "@/features/chat/ChatView";
import { pinsParams } from "@/features/chat/pins";
import { useServerPerms } from "@/features/servers/menus";
import { NsfwGate } from "@/features/servers/NsfwGate";
import { useT } from "@/i18n";
import { OnboardingGate } from "@/features/servers/Onboarding";
import { PERM } from "@/features/servers/perms";
import { VerificationGate } from "@/features/servers/VerificationGate";
import { useRouteParams } from "@/lib/params";
import { qk } from "@/lib/queryClient";
import { useLastChannel } from "@/stores/lastChannel";
import { colors, font } from "@/theme";

export default function ChannelScreen() {
  const t = useT();
  const { valid, ids, text } = useRouteParams(
    ["serverId", "channelId"] as const,
    ["name"],
  );
  const channels = useQuery({
    queryKey: qk.channels(ids.serverId ?? ""),
    queryFn: () => serversApi.channels(ids.serverId),
    enabled: valid,
  });
  const perms = useServerPerms(ids.serverId ?? "", valid);
  // Dernier salon consulté de ce serveur : rouvert au prochain appui sur le serveur dans le rail.
  useEffect(() => {
    if (valid) useLastChannel.getState().remember(ids.serverId, ids.channelId);
  }, [valid, ids.serverId, ids.channelId]);
  if (!valid) return <ErrorState message={t("conv.invalidChannel")} />;
  const channel = channels.data?.find((c) => c.id === ids.channelId);
  const name = channel?.name ?? text.name ?? t("conv.channelFallback");
  const isAnnouncement = channel?.type === "announcement";

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View>
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "700",
                  fontSize: font.lg,
                }}
                numberOfLines={1}
              >
                # {name}
              </Text>
              {channel?.topic ? (
                <Text
                  style={{ color: colors.textMuted, fontSize: font.xs }}
                  numberOfLines={1}
                >
                  {channel.topic}
                </Text>
              ) : null}
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              {isAnnouncement ? (
                <IconButton
                  icon="megaphone-outline"
                  label={t("conv.follow")}
                  onPress={() =>
                    router.push({
                      pathname: "/server/[serverId]/follow",
                      params: {
                        serverId: ids.serverId,
                        channelId: ids.channelId,
                        name,
                      },
                    })
                  }
                />
              ) : null}
              <IconButton
                icon="pin-outline"
                label={t("conv.pins")}
                onPress={() =>
                  router.push({
                    pathname: "/pins",
                    params: pinsParams({
                      kind: "channel",
                      serverId: ids.serverId,
                      channelId: ids.channelId,
                    }),
                  })
                }
              />
              <IconButton
                icon="search-outline"
                label={t("conv.search")}
                onPress={() =>
                  router.push({
                    pathname: "/search",
                    params: pinsParams({
                      kind: "channel",
                      serverId: ids.serverId,
                      channelId: ids.channelId,
                    }),
                  })
                }
              />
              <IconButton
                icon="people-outline"
                label={t("conv.members")}
                onPress={() => router.push(`/server/${ids.serverId}/members`)}
              />
            </View>
          ),
        }}
      />
      <VerificationGate serverId={ids.serverId}>
        <OnboardingGate serverId={ids.serverId}>
          <NsfwGate
            channelId={ids.channelId}
            name={name}
            nsfw={!!channel?.is_nsfw}
          >
            <ChatView
              publishable={isAnnouncement && perms.has(PERM.MANAGE_MESSAGES)}
              conversation={{
                kind: "channel",
                serverId: ids.serverId,
                channelId: ids.channelId,
              }}
              placeholder={t("conv.channelPlaceholder", { name })}
              header={
                <View style={{ padding: 16 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: font.xl,
                      fontWeight: "800",
                    }}
                  >
                    {t("conv.channelWelcome", { name })}
                  </Text>
                  <Text style={{ color: colors.textMuted }}>
                    {t("conv.channelStart")}
                  </Text>
                </View>
              }
            />
          </NsfwGate>
        </OnboardingGate>
      </VerificationGate>
    </>
  );
}
