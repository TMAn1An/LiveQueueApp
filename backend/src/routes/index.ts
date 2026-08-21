import { Router } from 'express';
import authRoutes from './auth.routes';
import queueRoutes from './queue.routes';
import serviceRoutes from './service.routes';
import counterRoutes from './counter.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/queues', queueRoutes);
router.use('/services', serviceRoutes);
router.use('/counters', counterRoutes);

export default router;
