import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";

const region = gcp.config.region || "us-west1";

// 1. GKE Autopilot cluster
const cluster = new gcp.container.Cluster("binti-lab", {
    location: region,
    enableAutopilot: true,
    deletionProtection: false,
});

// 2. Kubeconfig built from the cluster's outputs (uses gke-gcloud-auth-plugin)
const kubeconfig = pulumi
    .all([cluster.name, cluster.endpoint, cluster.masterAuth])
    .apply(([name, endpoint, auth]) => {
        const context = `binti-lab_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${auth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
      provideClusterInfo: true
`;
    });

const provider = new k8s.Provider("gke", { kubeconfig });

// 3. nginx Deployment
const labels = { app: "hello" };
const deployment = new k8s.apps.v1.Deployment("hello", {
    spec: {
        selector: { matchLabels: labels },
        replicas: 3,
        template: {
            metadata: { labels },
            spec: {
                containers: [{
                    name: "nginx",
                    image: "nginx:1.28",
                    ports: [{ containerPort: 80 }],
                    resources: { requests: { cpu: "250m", memory: "512Mi" } },
                }],
            },
        },
    },
}, { provider });

// 4. Public LoadBalancer Service
const service = new k8s.core.v1.Service("hello", {
    spec: {
        type: "LoadBalancer",
        selector: labels,
        ports: [{ port: 80, targetPort: 80 }],
    },
}, { provider, dependsOn: [deployment] });

export const clusterName = cluster.name;
export const serviceIp = service.status.loadBalancer.ingress[0].ip;