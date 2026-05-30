// 3-step onboarding wizard for an embedded Shopify (Remix + Polaris) app:
//   1. Choose Your Plan   (REQUIRED — redirects to Shopify managed pricing)
//   2. Connect a Courier  (optional, skippable)
//   3. Welcome            (optional, the finish line)
// Plan selection happens off-app (Shopify's pricing page); when the merchant
// returns with an active subscription the plan step disappears and they finish.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  Grid,
  Box,
  Icon,
  Divider,
  Checkbox,
  Collapsible,
  TextField,
  ProgressBar,
} from "@shopify/polaris";
import {
  CreditCardIcon,
  DeliveryFilledIcon,
  CheckIcon,
  ArrowRightIcon,
  StarFilledIcon,
  AlertTriangleIcon,
} from "@shopify/polaris-icons";

// --- Kit + host imports (adjust paths to where you placed the files) -------
import { authenticate } from "../shopify.server";
import { ensureStore, getActivePlan, listCouriersForStore } from "../onboarding-kit/onboarding.server";
import { courier_companies } from "../onboarding-kit/courierCompanies";
import { completeOnboarding, connectCourier } from "../onboarding-kit/actions";

// Edit these to match the plans you configured in Shopify managed pricing.
const PLANS = [
  {
    name: "Free",
    price: "$0/month",
    features: ["Up to 200 orders / month", "Core features", "Email support"],
  },
  {
    name: "Pro",
    price: "$19/month",
    badge: "Popular",
    features: ["Up to 1,500 orders / month", "Everything in Free", "Priority support"],
  },
  {
    name: "Enterprise",
    price: "$49/month",
    features: ["Unlimited orders", "Everything in Pro", "Dedicated support"],
  },
];

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);

  const selectedPlan = await getActivePlan(admin);

  let store;
  try {
    store = await ensureStore(session);
  } catch {
    return json(
      { success: false, error: "Failed to initialize store. Please refresh." },
      { status: 500 },
    );
  }

  const couriers = await listCouriersForStore(store.id);
  const shopDomain = session.shop;
  const shopName = shopDomain.split(".myshopify.com")[0] || shopDomain.split(".")[0];

  return json({
    store,
    couriers,
    selectedPlan,
    shopDomain,
    shopName,
    APP_NAME: process.env.SHOPIFY_APP_NAME || "your-app",
  });
}

export default function OnboardingPage() {
  const { store, couriers, selectedPlan, shopName, APP_NAME } = useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();

  // Plan step only shows when no plan is active yet.
  const steps = useMemo(() => {
    const base = [
      {
        id: "couriers",
        title: "Connect a Courier",
        description: "Optional: connect a courier to automate tracking.",
        icon: DeliveryFilledIcon,
        optional: true,
      },
      {
        id: "welcome",
        title: selectedPlan
          ? `Welcome to the ${cap(selectedPlan)} plan`
          : "Welcome",
        description: "You're all set.",
        icon: StarFilledIcon,
      },
    ];
    if (!selectedPlan) {
      return [
        {
          id: "plan",
          title: "Choose Your Plan",
          description: "Select a plan to get started.",
          icon: CreditCardIcon,
        },
        ...base,
      ];
    }
    return base;
  }, [selectedPlan]);

  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const progress = ((currentStep + 1) / steps.length) * 100;

  // Already onboarded? Bounce to the app.
  useEffect(() => {
    if (store?.meta_data?.isOnboarded) navigate("/app");
  }, []);

  // The plan step gates progress; everything else is freely skippable.
  const canProceed = steps[currentStep]?.id === "plan" ? !!selectedPlan : true;

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((s) => s + 1);
    } else {
      finish();
    }
  }, [currentStep, steps.length]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  }, [currentStep]);

  const finish = async () => {
    await completeOnboarding(store, selectedPlan);
    navigate("/app");
  };

  // Redirect to Shopify's managed pricing page to actually pick/pay for a plan.
  const handleSelectPlan = () => {
    const url = `https://admin.shopify.com/store/${shopName}/charges/${APP_NAME}/pricing_plans`;
    window?.top?.location.replace(url);
  };

  // --- Courier step state --------------------------------------------------
  const [credentials, setCredentials] = useState(() =>
    Object.fromEntries(
      courier_companies.map((c) => [
        c.id,
        {
          requiredData: Object.fromEntries((c.possible_fields || []).map((f) => [f.save_key, ""])),
          rawInput: "",
          isConnected: false,
          courierCode: c.courier_code,
          logo: c.logo,
          color: c.color,
          name: c.name,
          description: c.courier_name,
          possibleFields: c.possible_fields || [],
        },
      ]),
    ),
  );
  const [expanded, setExpanded] = useState({});
  const [courierError, setCourierError] = useState("");

  // Reflect already-connected couriers from the loader.
  useEffect(() => {
    if (!Array.isArray(couriers)) return;
    setCredentials((prev) => {
      const next = { ...prev };
      for (const key in next) {
        const match = couriers.find((c) => c.code === next[key].courierCode);
        next[key].isConnected = !!match;
        if (match?.meta_data) {
          next[key].requiredData = { ...next[key].requiredData, ...match.meta_data };
        }
      }
      return next;
    });
  }, [couriers]);

  const setField = useCallback((id, field, value) => {
    setCredentials((prev) => ({
      ...prev,
      [id]: { ...prev[id], requiredData: { ...prev[id].requiredData, [field]: value } },
    }));
  }, []);

  const setRaw = useCallback((id, value) => {
    setCredentials((prev) => ({ ...prev, [id]: { ...prev[id], rawInput: value } }));
  }, []);

  const saveCourier = useCallback(
    async (id) => {
      setCourierError("");
      const config = credentials[id];

      let meta_data = {};
      if (config.possibleFields.length > 0) {
        meta_data = { ...config.requiredData };
      } else {
        config.rawInput.split("\n").forEach((line) => {
          const [key, ...rest] = line.split(":");
          if (key && rest.length) meta_data[key.trim()] = rest.join(":").trim();
        });
      }

      const res = await connectCourier({
        storeID: store.id,
        courierCode: config.courierCode,
        meta_data,
      });
      if (!res.success) {
        setCourierError(res.error || "Failed to save courier");
        return;
      }
      setCredentials((prev) => ({ ...prev, [id]: { ...prev[id], isConnected: true } }));
    },
    [credentials, store?.id],
  );

  const connectedCount = Object.values(credentials).filter((c) => c.isConnected).length;

  // --- Render --------------------------------------------------------------
  const renderStep = () => {
    const id = steps[currentStep]?.id;
    if (id === "plan") return <PlanStep onSelect={handleSelectPlan} />;
    if (id === "couriers")
      return (
        <CourierStep
          credentials={credentials}
          expanded={expanded}
          setExpanded={setExpanded}
          setField={setField}
          setRaw={setRaw}
          saveCourier={saveCourier}
          connectedCount={connectedCount}
          error={courierError}
          onSkip={nextStep}
        />
      );
    return <WelcomeStep selectedPlan={selectedPlan} connectedCount={connectedCount} onFinish={finish} loading={navigation.state !== "idle"} />;
  };

  return (
    <div style={{ background: "#fff", minHeight: "100vh", paddingBottom: 96 }}>
      <Page
        title="Set up your app"
        subtitle={`Step ${currentStep + 1} of ${steps.length}`}
        titleMetadata={<Badge tone="info">Setup</Badge>}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <div style={{ padding: 20 }}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="bodyLg" fontWeight="semibold">
                        {steps[currentStep].title}
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        {Math.round(progress)}% Complete
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={progress} tone="primary" size="large" />
                    <InlineStack gap="200" wrap>
                      {steps.map((s, i) => {
                        const isActive = i === currentStep;
                        const isDone = completedSteps.has(i);
                        const accessible = i <= currentStep;
                        return (
                          <div
                            key={s.id}
                            onClick={() => accessible && setCurrentStep(i)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 10px",
                              borderRadius: 6,
                              cursor: accessible ? "pointer" : "default",
                              backgroundColor: isActive ? "#f0f6ff" : "transparent",
                              opacity: accessible ? 1 : 0.5,
                            }}
                          >
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: isDone ? "#008060" : isActive ? "#0B6AEA" : "#e5e5e5",
                                color: "#fff",
                                fontSize: 12,
                                fontWeight: 600,
                              }}
                            >
                              {isDone ? "✓" : i + 1}
                            </div>
                            <Text
                              variant="bodyMd"
                              tone={isActive ? undefined : isDone ? "success" : "subdued"}
                              fontWeight={isActive ? "semibold" : undefined}
                            >
                              {s.title}
                            </Text>
                            {s.optional && (
                              <Badge size="small" tone="info">
                                Optional
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </InlineStack>
                  </BlockStack>
                </div>
              </Card>

              {renderStep()}
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Sticky footer nav */}
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            width: "100%",
            backgroundColor: "#fff",
            boxShadow: "0 -1px 4px rgba(0,0,0,0.06)",
            zIndex: 100,
          }}
        >
          <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
            <InlineStack align="space-between">
              <Button onClick={prevStep} disabled={currentStep === 0} variant="secondary">
                Previous
              </Button>
              <InlineStack gap="200">
                {steps[currentStep].optional && (
                  <Button onClick={nextStep} variant="tertiary">
                    Skip for now
                  </Button>
                )}
                <Button onClick={nextStep} variant="primary" disabled={!canProceed} icon={ArrowRightIcon}>
                  {currentStep === steps.length - 1 ? "Finish Setup" : "Continue"}
                </Button>
              </InlineStack>
            </InlineStack>
          </div>
        </div>
      </Page>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
function PlanStep({ onSelect }) {
  return (
    <Card>
      <div style={{ padding: 20 }}>
        <BlockStack gap="500">
          <BlockStack gap="200">
            <Text variant="headingLg" as="h2">
              Choose Your Plan
            </Text>
            <Text variant="bodyMd" tone="subdued">
              Pick a plan to get started. You can change it anytime from billing.
            </Text>
          </BlockStack>
          <Grid columns={{ xs: 1, sm: 3, md: 3, lg: 3, xl: 3 }} gap="400">
            {PLANS.map((plan) => (
              <Grid.Cell key={plan.name}>
                <Card sectioned>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text variant="headingMd" fontWeight="semibold">
                          {plan.name}
                        </Text>
                        {plan.badge && <Badge tone="success">{plan.badge}</Badge>}
                      </InlineStack>
                      <Text variant="bodyLg" fontWeight="bold">
                        {plan.price}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      {plan.features.map((f) => (
                        <Text key={f} variant="bodySm">
                          • {f}
                        </Text>
                      ))}
                    </BlockStack>
                    <Button onClick={onSelect} variant="primary" fullWidth>
                      Select Plan
                    </Button>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
          <Banner tone="info">
            <Text as="p">You'll be taken to Shopify's secure billing page to confirm your plan.</Text>
          </Banner>
        </BlockStack>
      </div>
    </Card>
  );
}

function CourierStep({ credentials, expanded, setExpanded, setField, setRaw, saveCourier, connectedCount, error, onSkip }) {
  return (
    <Card>
      <div style={{ padding: 20 }}>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <BlockStack gap="100">
              <Text variant="headingLg" as="h2">
                Connect a Courier (Optional)
              </Text>
              <Text variant="bodyMd" tone="subdued">
                Connect at least one courier to automate tracking updates.
              </Text>
            </BlockStack>
            <Badge tone="info">{`${connectedCount}/${Object.keys(credentials).length} Connected`}</Badge>
          </InlineStack>

          <Banner tone="info" icon={AlertTriangleIcon}>
            <Text as="p">
              You can skip this and add couriers later from settings — tracking will just be manual until then.
            </Text>
          </Banner>

          {error && (
            <Banner title="Courier Error" tone="critical" icon={AlertTriangleIcon}>
              <Text as="p">{error}</Text>
            </Banner>
          )}

          <Grid>
            {Object.entries(credentials).map(([key, config]) => (
              <Grid.Cell key={key} columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                <Card sectioned>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <InlineStack gap="300" align="center">
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 8,
                            backgroundColor: config.color || "#f1f5f9",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            flexShrink: 0,
                            border: "1px solid #e5e5e5",
                          }}
                        >
                          <img
                            src={config.logo}
                            alt={config.name}
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                            onError={(e) => {
                              e.target.style.display = "none";
                              e.target.parentElement.innerHTML = `<span style="font-size:24px">📦</span>`;
                            }}
                          />
                        </div>
                        <BlockStack gap="100">
                          <Text variant="bodyLg" as="h4" fontWeight="semibold">
                            {config.name}
                          </Text>
                          <Text variant="bodyMd" as="p" tone="subdued">
                            {config.description}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      <InlineStack gap="200" align="center">
                        {config.isConnected && (
                          <Badge tone="success" icon={CheckIcon}>
                            Connected
                          </Badge>
                        )}
                        <Checkbox
                          label=""
                          checked={!!expanded[key] || config.isConnected}
                          onChange={(v) => setExpanded((prev) => ({ ...prev, [key]: v }))}
                          disabled={config.isConnected}
                        />
                      </InlineStack>
                    </InlineStack>

                    <Collapsible open={!!expanded[key] || config.isConnected} id={`courier-${key}`}>
                      <BlockStack gap="300">
                        <Divider />
                        {config.possibleFields.length > 0 ? (
                          <InlineStack gap="200">
                            {config.possibleFields.map(({ name, save_key }) => {
                              const isSecret = /password|secret|key|token/i.test(name);
                              return (
                                <Box width="100%" key={save_key}>
                                  <TextField
                                    label={name}
                                    type={isSecret ? "password" : "text"}
                                    value={config.requiredData[save_key] || ""}
                                    onChange={(v) => setField(key, save_key, v)}
                                    autoComplete="off"
                                    placeholder={`Enter ${name}`}
                                    disabled={config.isConnected}
                                  />
                                </Box>
                              );
                            })}
                          </InlineStack>
                        ) : (
                          <BlockStack gap="100">
                            <Text variant="bodySm" tone="subdued">
                              Paste API details below (one per line as key: value)
                            </Text>
                            <TextField
                              label="Credentials"
                              value={config.rawInput || ""}
                              onChange={(v) => setRaw(key, v)}
                              multiline={4}
                              disabled={config.isConnected}
                              placeholder={"apiKey: abc123\napiPassword: secret456"}
                              autoComplete="off"
                            />
                          </BlockStack>
                        )}

                        <InlineStack>
                          {config.isConnected ? (
                            <Badge tone="success" icon={CheckIcon}>
                              Connected Successfully
                            </Badge>
                          ) : (
                            <Button
                              onClick={() => saveCourier(key)}
                              variant="primary"
                              disabled={
                                config.possibleFields.length > 0
                                  ? Object.values(config.requiredData).some((v) => !String(v || "").trim())
                                  : !config.rawInput?.trim()
                              }
                            >
                              Connect
                            </Button>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </Collapsible>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
        </BlockStack>
      </div>
    </Card>
  );
}

function WelcomeStep({ selectedPlan, connectedCount, onFinish, loading }) {
  return (
    <Card>
      <div style={{ padding: 0, overflow: "hidden" }}>
        {/* Hero */}
        <div
          style={{
            background: "linear-gradient(135deg, #0B6AEA 0%, #6A36FF 100%)",
            padding: "48px 24px",
            textAlign: "center",
            color: "#fff",
          }}
        >
          <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 12 }}>🎉</div>
          <Text variant="heading2xl" as="h1" tone="text-inverse">
            You're all set!
          </Text>
          <div style={{ maxWidth: 520, margin: "12px auto 0" }}>
            <Text variant="bodyLg" as="p" tone="text-inverse">
              {selectedPlan
                ? `Your ${cap(selectedPlan)} plan is active. Everything's ready to go.`
                : "Everything's ready to go."}
            </Text>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <BlockStack gap="400">
            <Grid columns={{ xs: 1, sm: 3, md: 3, lg: 3, xl: 3 }} gap="400">
              <Grid.Cell>
                <Card sectioned>
                  <BlockStack gap="100" align="center">
                    <Icon source={CreditCardIcon} tone="success" />
                    <Text variant="bodyMd" fontWeight="semibold">
                      Plan {selectedPlan ? "Active" : "Selected"}
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell>
                <Card sectioned>
                  <BlockStack gap="100" align="center">
                    <Icon source={DeliveryFilledIcon} tone={connectedCount ? "success" : "subdued"} />
                    <Text variant="bodyMd" fontWeight="semibold">
                      {connectedCount} Courier{connectedCount === 1 ? "" : "s"}
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell>
                <Card sectioned>
                  <BlockStack gap="100" align="center">
                    <Icon source={CheckIcon} tone="success" />
                    <Text variant="bodyMd" fontWeight="semibold">
                      Setup Complete
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>

            <InlineStack align="center">
              <Button variant="primary" size="large" icon={ArrowRightIcon} onClick={onFinish} loading={loading}>
                Go to Dashboard
              </Button>
            </InlineStack>
          </BlockStack>
        </div>
      </div>
    </Card>
  );
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
