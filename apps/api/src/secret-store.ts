export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  rotate(name: string): Promise<string>;
}

export class EnvSecretStore implements SecretStore {
  async get(name: string): Promise<string | undefined> {
    return process.env[name];
  }

  async set(name: string, value: string): Promise<void> {
    process.env[name] = value;
  }

  async rotate(name: string): Promise<string> {
    const current = process.env[name];
    if (!current) {
      throw new Error(`Secret ${name} not found for rotation`);
    }
    return current;
  }
}

export class AwsSecretsManagerStore implements SecretStore {
  async get(_name: string): Promise<string | undefined> {
    throw new Error('AwsSecretsManagerStore not configured — install @aws-sdk/client-secrets-manager and set SECRET_STORE=aws');
  }

  async set(_name: string, _value: string): Promise<void> {
    throw new Error('AwsSecretsManagerStore not configured — install @aws-sdk/client-secrets-manager and set SECRET_STORE=aws');
  }

  async rotate(_name: string): Promise<string> {
    throw new Error('AwsSecretsManagerStore not configured — install @aws-sdk/client-secrets-manager and set SECRET_STORE=aws');
  }
}

export function createSecretStore(): SecretStore {
  const storeType = process.env.SECRET_STORE?.toLowerCase();
  if (storeType === 'aws') {
    return new AwsSecretsManagerStore();
  }
  return new EnvSecretStore();
}

export const secretStore = createSecretStore();