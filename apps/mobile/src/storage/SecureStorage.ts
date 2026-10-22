/**
 * Orbit Chat Mobile — Native Secure Storage Interface
 * Spec Reference: 12_SECURITY_PRIVACY_SPEC.md
 *
 * Platform-agnostic secure storage. React Native Keychain / Expo SecureStore
 * is injected via the SecureStorageDriver interface so this layer stays testable.
 */

export interface SecureStorageDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export class MobileSecureStorage {
  private driver: SecureStorageDriver;
  private static readonly KEYS = {
    AUTH_TOKEN: 'orbit.auth.token',
    REFRESH_TOKEN: 'orbit.auth.refresh',
    E2EE_IDENTITY_KEY: 'orbit.e2ee.identity',
    E2EE_SESSION_KEYS: 'orbit.e2ee.sessions',
    BIOMETRIC_FLAG: 'orbit.biometric.enabled',
    ACTIVE_WORKSPACE: 'orbit.workspace.active',
  } as const;

  constructor(driver: SecureStorageDriver) {
    this.driver = driver;
  }

  async saveAuthToken(token: string): Promise<void> {
    await this.driver.setItem(MobileSecureStorage.KEYS.AUTH_TOKEN, token);
  }

  async getAuthToken(): Promise<string | null> {
    return this.driver.getItem(MobileSecureStorage.KEYS.AUTH_TOKEN);
  }

  async saveRefreshToken(token: string): Promise<void> {
    await this.driver.setItem(MobileSecureStorage.KEYS.REFRESH_TOKEN, token);
  }

  async saveE2EEIdentityKey(key: string): Promise<void> {
    await this.driver.setItem(MobileSecureStorage.KEYS.E2EE_IDENTITY_KEY, key);
  }

  async getE2EEIdentityKey(): Promise<string | null> {
    return this.driver.getItem(MobileSecureStorage.KEYS.E2EE_IDENTITY_KEY);
  }

  async setActiveWorkspaceId(workspaceId: string): Promise<void> {
    await this.driver.setItem(MobileSecureStorage.KEYS.ACTIVE_WORKSPACE, workspaceId);
  }

  async getActiveWorkspaceId(): Promise<string | null> {
    return this.driver.getItem(MobileSecureStorage.KEYS.ACTIVE_WORKSPACE);
  }

  async clearAll(): Promise<void> {
    await Promise.all(
      Object.values(MobileSecureStorage.KEYS).map((k) => this.driver.deleteItem(k))
    );
  }
}
