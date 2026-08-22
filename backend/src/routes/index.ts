import { Router } from 'express';
import authRoutes from './auth.routes';
import queueRoutes from './queue.routes';
import serviceRoutes from './service.routes';
import counterRoutes from './counter.routes';
import tokenRoutes from './token.routes';
import deviceRoutes from './device.routes';
import publicRoutes from './public.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/queues', queueRoutes);
router.use('/services', serviceRoutes);
router.use('/counters', counterRoutes);
router.use('/tokens', tokenRoutes);
router.use('/devices', deviceRoutes);
router.use('/public', publicRoutes);

export default router;
