/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import {
  AuthScreen,
  OnboardingScreen,
  SplashScreen,
} from './components/AuthAndOnboardingScreens';
import { BillScannerFlow, type CapturedPage } from './components/BillScannerFlow';
import { DashboardScreen } from './components/DashboardScreen';
import {
  DistributorDetailScreen,
  DistributorListScreen,
  InvoiceDetailScreen,
  InvoiceHistoryScreen,
} from './components/DistributorsAndInvoicesScreens';
import {
  ExpiryManagementScreen,
  LowStockScreen,
} from './components/ExpiryAndLowStockScreens';
import {
  InventoryListScreen,
  MedicineDetailScreen,
  MedicineFormScreen,
} from './components/InventoryScreens';
import {
  NotificationsScreen,
  ProfileSettingsScreen,
  ReportsScreen,
} from './components/ReportsNotificationsProfileScreens';
import type { AppScreen, InvoiceDraft } from './domain/types';
import { usePharmacyStore } from './store/usePharmacyStore';

function getInitialScreen(): AppScreen {
  if (typeof window === 'undefined') return 'home';
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') return 'home';
  const requested = params.get('screen') as AppScreen | null;
  if (requested && ['splash', 'onboarding', 'auth', 'home', 'scanner', 'inventory', 'expiry', 'low_stock', 'distributors', 'invoices', 'reports', 'notifications', 'profile'].includes(requested)) {
    return requested;
  }
  return 'home';
}

export default function App() {
  const store = usePharmacyStore();
  const [screen, setScreen] = useState<AppScreen>(getInitialScreen);
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>(undefined);
  const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceDraft | null>(null);
  const [whatsappModal, setWhatsappModal] = useState<{
    title: string;
    message: string;
    phone?: string;
  } | null>(null);
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const showToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const navigate = useCallback((nextScreen: AppScreen, entityId?: string) => {
    setScreen(nextScreen);
    setSelectedEntityId(entityId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const openWhatsapp = useCallback((title: string, message: string, phone?: string) => {
    setWhatsappModal({ title, message, phone });
  }, []);

  // Full-screen standalone flows (Splash, Onboarding, Auth)
  if (screen === 'splash') {
    return <SplashScreen onContinue={() => navigate('onboarding')} />;
  }
  if (screen === 'onboarding') {
    return (
      <OnboardingScreen
        onFinish={() => navigate('home')}
        onSkip={() => navigate('home')}
      />
    );
  }
  if (screen === 'auth') {
    return (
      <AuthScreen
        currentUser={store.state.user}
        onAuthenticated={(profile) => {
          store.updateUserProfile(profile);
          showToast('success', `Signed in to ${profile.storeName || store.state.user.storeName}.`);
          navigate('home');
        }}
        onOpenOnboarding={() => navigate('onboarding')}
      />
    );
  }

  const selectedMedicine = selectedEntityId
    ? store.state.medicines.find((m) => m.id === selectedEntityId)
    : undefined;
  const selectedDistributor = selectedEntityId
    ? store.state.distributors.find((d) => d.id === selectedEntityId)
    : undefined;
  const selectedInvoice = selectedEntityId
    ? store.state.invoices.find((i) => i.id === selectedEntityId)
    : undefined;

  return (
    <AppShell
      screen={screen}
      onNavigate={navigate}
      state={store.state}
      unreadNotifications={store.unreadNotificationCount}
      isDark={store.isDark}
      onToggleDark={() => store.setIsDark((d) => !d)}
      isOnline={store.isOnline}
      onAddRecentSearch={store.addRecentSearch}
      whatsappModal={whatsappModal}
      onCloseWhatsapp={() => setWhatsappModal(null)}
      toast={toast}
      onDismissToast={() => setToast(null)}
    >
      {screen === 'home' && (
        <DashboardScreen state={store.state} onNavigate={navigate} />
      )}

      {(screen === 'scanner' ||
        screen === 'preview_crop' ||
        screen === 'ai_processing' ||
        screen === 'invoice_verify') && (
        <BillScannerFlow
          screen={screen}
          state={store.state}
          pages={capturedPages}
          setPages={setCapturedPages}
          draft={invoiceDraft}
          setDraft={setInvoiceDraft}
          onNavigate={navigate}
          onCommitInvoice={store.commitInvoice}
          onShowToast={showToast}
        />
      )}

      {screen === 'inventory' && (
        <InventoryListScreen state={store.state} onNavigate={navigate} />
      )}

      {screen === 'medicine_detail' && (
        <MedicineDetailScreen
          medicine={selectedMedicine}
          state={store.state}
          onNavigate={navigate}
          onAdjustStock={store.adjustBatchStock}
          onDeleteMedicine={store.deleteMedicine}
          onCreateReturn={store.createPurchaseReturn}
          onShowToast={showToast}
        />
      )}

      {screen === 'medicine_form' && (
        <MedicineFormScreen
          editingMedicine={selectedMedicine}
          state={store.state}
          onSave={(med, batch) => {
            const id = store.saveMedicine(med, batch);
            showToast(
              'success',
              selectedMedicine ? `Updated ${med.name}.` : `Added ${med.name} to inventory.`
            );
            navigate('medicine_detail', id);
          }}
          onCancel={() =>
            navigate(selectedMedicine ? 'medicine_detail' : 'inventory', selectedMedicine?.id)
          }
        />
      )}

      {screen === 'expiry' && (
        <ExpiryManagementScreen
          state={store.state}
          onNavigate={navigate}
          onCreateReturn={store.createPurchaseReturn}
          onOpenWhatsapp={openWhatsapp}
          onShowToast={showToast}
        />
      )}

      {screen === 'low_stock' && (
        <LowStockScreen
          state={store.state}
          onUpdateMinStock={store.updateMinStockLevel}
          onNavigate={navigate}
          onOpenWhatsapp={openWhatsapp}
          onShowToast={showToast}
        />
      )}

      {screen === 'distributors' && (
        <DistributorListScreen
          state={store.state}
          onNavigate={navigate}
          onSaveDistributor={store.saveDistributor}
          onShowToast={showToast}
        />
      )}

      {screen === 'distributor_detail' && (
        <DistributorDetailScreen
          distributor={selectedDistributor}
          state={store.state}
          onNavigate={navigate}
          onRecordPayment={store.recordDistributorPayment}
          onMarkReturnCredited={store.markReturnCredited}
          onOpenWhatsapp={openWhatsapp}
          onShowToast={showToast}
        />
      )}

      {screen === 'invoices' && (
        <InvoiceHistoryScreen state={store.state} onNavigate={navigate} />
      )}

      {screen === 'invoice_detail' && (
        <InvoiceDetailScreen
          invoice={selectedInvoice}
          state={store.state}
          onNavigate={navigate}
          onToggleReconciled={store.toggleInvoiceReconciled}
          onOpenWhatsapp={openWhatsapp}
        />
      )}

      {screen === 'reports' && (
        <ReportsScreen
          state={store.state}
          onNavigate={navigate}
          onOpenWhatsapp={openWhatsapp}
          onShowToast={showToast}
        />
      )}

      {screen === 'notifications' && (
        <NotificationsScreen
          notifications={store.notifications}
          onMarkRead={store.markNotificationRead}
          onMarkAllRead={store.markAllNotificationsRead}
          onNavigate={navigate}
        />
      )}

      {screen === 'profile' && (
        <ProfileSettingsScreen
          state={store.state}
          isDark={store.isDark}
          onToggleDark={() => store.setIsDark((d) => !d)}
          isOnline={store.isOnline}
          isSyncing={store.isSyncing}
          onSyncNow={store.syncNow}
          onUpdateProfile={store.updateUserProfile}
          onSwitchRole={store.switchRole}
          onRestoreBackup={store.restoreFromBackup}
          onResetDemo={store.resetToDemoData}
          onNavigate={navigate}
          onShowToast={showToast}
        />
      )}
    </AppShell>
  );
}
