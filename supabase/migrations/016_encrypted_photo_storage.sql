update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'photos';
