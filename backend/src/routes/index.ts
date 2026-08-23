import { Router } from 'express';
import authRoutes from './auth.routes';
import queueRoutes from './queue.routes';
import serviceRoutes from './service.routes';
import counterRoutes from './counter.routes';
import tokenRoutes from './token.routes';
import deviceRoutes from './device.routes';
import publicRoutes from './public.routes';
import organizationRoutes from './organization.routes';
import staffRoutes from './staff.routes';
import dashboardRoutes from './dashboard.routes';
import reportRoutes from './report.routes';
import auditLogRoutes from './auditLog.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/queues', queueRoutes);
router.use('/services', serviceRoutes);
router.use('/counters', counterRoutes);
router.use('/tokens', tokenRoutes);
router.use('/devices', deviceRoutes);
router.use('/public', publicRoutes);
router.use('/organizations', organizationRoutes);
router.use('/staff', staffRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/audit-logs', auditLogRoutes);

export default router;
