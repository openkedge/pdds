

export interface K8sObjectMeta {
  name: string;
  namespace?: string;
  resourceVersion: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  deletionTimestamp?: string;
}

export interface K8sPodSpec {
  nodeName?: string;
  containers: Array<{
    name: string;
    image: string;
  }>;
  tolerations?: Array<{
    key: string;
    operator: string;
    value?: string;
    effect: string;
  }>;
  terminationGracePeriodSeconds?: number;
}

export interface K8sPodStatus {
  phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
  conditions?: Array<{
    type: string;
    status: "True" | "False" | "Unknown";
    reason?: string;
  }>;
  podIP?: string;
}

export interface K8sPod {
  apiVersion: "v1";
  kind: "Pod";
  metadata: K8sObjectMeta;
  spec: K8sPodSpec;
  status: K8sPodStatus;
}

export interface K8sNodeSpec {
  unschedulable?: boolean;
  taints?: Array<{
    key: string;
    value?: string;
    effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
  }>;
}

export interface K8sNodeStatus {
  conditions: Array<{
    type: "Ready" | "MemoryPressure" | "DiskPressure" | "PIDPressure" | "NetworkUnavailable";
    status: "True" | "False" | "Unknown";
    reason?: string;
  }>;
  capacity?: Record<string, string>;
  allocatable?: Record<string, string>;
}

export interface K8sNode {
  apiVersion: "v1";
  kind: "Node";
  metadata: K8sObjectMeta;
  spec: K8sNodeSpec;
  status: K8sNodeStatus;
}

export interface K8sDeploymentSpec {
  replicas: number;
  selector: {
    matchLabels: Record<string, string>;
  };
  template: {
    metadata: {
      labels: Record<string, string>;
    };
    spec: {
      containers: Array<{
        name: string;
        image: string;
      }>;
    };
  };
  strategy?: {
    type: "RollingUpdate" | "Recreate";
    rollingUpdate?: {
      maxSurge?: number | string;
      maxUnavailable?: number | string;
    };
  };
}

export interface K8sDeploymentStatus {
  replicas: number;
  updatedReplicas: number;
  readyReplicas: number;
  availableReplicas: number;
  observedGeneration?: number;
}

export interface K8sDeployment {
  apiVersion: "apps/v1";
  kind: "Deployment";
  metadata: K8sObjectMeta;
  spec: K8sDeploymentSpec;
  status: K8sDeploymentStatus;
}

export interface K8sPodDisruptionBudgetSpec {
  minAvailable?: number;
  maxUnavailable?: number;
  selector: {
    matchLabels: Record<string, string>;
  };
}

export interface K8sPodDisruptionBudgetStatus {
  currentHealthy: number;
  desiredHealthy: number;
  disruptionsAllowed: number;
  expectedPods: number;
}

export interface K8sPodDisruptionBudget {
  apiVersion: "policy/v1";
  kind: "PodDisruptionBudget";
  metadata: K8sObjectMeta;
  spec: K8sPodDisruptionBudgetSpec;
  status: K8sPodDisruptionBudgetStatus;
}

export interface K8sNetworkPolicySpec {
  podSelector: {
    matchLabels: Record<string, string>;
  };
  ingress?: Array<{
    from?: Array<{
      podSelector?: { matchLabels: Record<string, string> };
      namespaceSelector?: { matchLabels: Record<string, string> };
      ipBlock?: { cidr: string; except?: string[] };
    }>;
    ports?: Array<{
      protocol?: "TCP" | "UDP" | "SCTP";
      port?: number | string;
    }>;
  }>;
  egress?: Array<{
    to?: Array<{
      podSelector?: { matchLabels: Record<string, string> };
      namespaceSelector?: { matchLabels: Record<string, string> };
      ipBlock?: { cidr: string; except?: string[] };
    }>;
    ports?: Array<{
      protocol?: "TCP" | "UDP" | "SCTP";
      port?: number | string;
    }>;
  }>;
  policyTypes: Array<"Ingress" | "Egress">;
}

export interface K8sNetworkPolicy {
  apiVersion: "networking.k8s.io/v1";
  kind: "NetworkPolicy";
  metadata: K8sObjectMeta;
  spec: K8sNetworkPolicySpec;
}

export interface AdmissionWebhookReviewRequest {
  uid: string;
  operation: "CREATE" | "UPDATE" | "DELETE" | "CONNECT";
  resource: {
    group: string;
    version: string;
    resource: string;
  };
  name: string;
  namespace?: string | undefined;
  object?: unknown;
  oldObject?: unknown;
  userInfo?: {
    username: string;
    groups?: string[];
  } | undefined;
  headers?: Record<string, string> | undefined;
}

export interface AdmissionWebhookReviewResponse {
  uid: string;
  allowed: boolean;
  status?: {
    code: number;
    message: string;
  };
}
