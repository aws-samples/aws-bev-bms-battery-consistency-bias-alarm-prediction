FROM amazonlinux:2

# install apt dependencies
RUN yum update -y && yum install -y gcc gcc-c++ make \
    openssl-devel \
    python3-pip \
    python3-devel \
    python3-setuptools \
    libffi-devel \
    openldap-devel

RUN amazon-linux-extras install -y nginx1

# create python virtual environment tool
RUN pip3 --no-cache-dir install --upgrade \
    wheel==0.35.1 \
    apache-superset==0.37.2 \
    Pillow==8.0.1 \
    gunicorn==20.0.4 \
    gevent==20.9.0 \
    PyAthenaJDBC==2.1.0 \
    PyAthena==2.0.0

# superset configuration
RUN export LC_ALL=C.UTF-8 \
 && export LANG=C.UTF-8 \
 && superset db upgrade \
 && export FLASK_APP=superset \
 && superset fab create-admin \
    --username admin \
    --firstname Superset \
    --lastname Admin \
    --email admin@superset.com \
    --password admin \
 && superset init

# copy nginx configure into container
COPY nginx.conf /etc/nginx/nginx.conf

# copy start script into container
COPY entrypoint.sh /home/entrypoint.sh
RUN chmod a+x /home/entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/home/entrypoint.sh"]