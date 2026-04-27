import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { getQueue, QUEUE_NAMES } from '../queue/setup.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/upload', (_req: Request, res: Response) => {
  res.render('upload', { page: 'upload', title: 'Upload CSV' });
});

router.post('/upload', upload.single('csv'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.render('upload', {
        page: 'upload',
        title: 'Upload CSV',
        message: 'No file uploaded',
        messageType: 'error',
      });
      return;
    }

    if (!file.originalname.endsWith('.csv')) {
      res.render('upload', {
        page: 'upload',
        title: 'Upload CSV',
        message: 'Please upload a .csv file',
        messageType: 'error',
      });
      return;
    }

    // Enqueue intake job
    const intakeQueue = getQueue(QUEUE_NAMES.INTAKE);
    const job = await intakeQueue.add('intake', {
      csvBuffer: file.buffer.toString('base64'),
      filename: file.originalname,
    });

    console.log(`[upload] CSV "${file.originalname}" enqueued as job ${job.id}`);

    // Redirect to dashboard — the run will appear once intake processes
    res.render('upload', {
      page: 'upload',
      title: 'Upload CSV',
      message: `"${file.originalname}" uploaded and queued for processing. Check the dashboard for progress.`,
      messageType: 'success',
    });
  } catch (err) {
    console.error('[upload] Error:', err);
    res.render('upload', {
      page: 'upload',
      title: 'Upload CSV',
      message: 'Upload failed. Please try again.',
      messageType: 'error',
    });
  }
});

export default router;
