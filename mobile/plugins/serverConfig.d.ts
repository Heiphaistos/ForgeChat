export declare function distributedServerConfig(
  appEnv: string,
  apiUrl: string | undefined,
  livekitUrl: string | undefined,
): { apiUrl: string; livekitHost: string | null }
export declare function isForbiddenPublicHost(host: string): boolean
